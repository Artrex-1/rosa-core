'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { sendError } = require('../utils/error-response');
const log = require('../utils/logger');

if (!process.env.WORKSPACE_ROOT) {
  log.warn('WORKSPACE_ROOT is niet ingesteld — /files routes zijn uitgeschakeld');
}
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT
  ? path.resolve(process.env.WORKSPACE_ROOT)
  : null;

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_DIR_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 50;

// Sensitive file patterns that must never be served
const BLOCKED_EXTENSIONS = new Set(['.env', '.key', '.pem', '.p12', '.pfx', '.jks']);
const BLOCKED_FILENAMES = new Set(['.env', '.env.local', '.env.production', '.env.staging']);

function isSensitiveFile(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  return BLOCKED_FILENAMES.has(basename) || BLOCKED_EXTENSIONS.has(ext) || basename.startsWith('.env.');
}

/**
 * Validate and resolve a path, ensuring it stays within the workspace.
 * Returns the resolved absolute path or null if invalid.
 */
function resolveSafePath(inputPath) {
  if (!WORKSPACE_ROOT) return null;
  if (!inputPath) return WORKSPACE_ROOT;

  // Normalize and resolve against workspace root
  const resolved = path.resolve(WORKSPACE_ROOT, inputPath);

  // Must be within workspace
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    return null;
  }

  return resolved;
}

/**
 * Detect binary files by checking for null bytes in first 8KB
 */
function isBinary(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * GET /files/read?path=relative/path
 * Read a file from the workspace (read-only, text files only)
 */
router.get('/read', (req, res) => {
  const filePath = resolveSafePath(req.query.path);

  if (!filePath) {
    return sendError(res, 403, 'Path is outside workspace', null, req);
  }

  if (!req.query.path) {
    return sendError(res, 400, 'path parameter is required', null, req);
  }

  if (isSensitiveFile(filePath)) {
    return sendError(res, 403, 'Access to sensitive files (.env, .key, .pem, etc.) is blocked', null, req);
  }

  try {
    const stat = fs.statSync(filePath);

    if (!stat.isFile()) {
      return sendError(res, 400, 'Path is not a file. Use /files/list for directories.', null, req);
    }

    if (isBinary(filePath)) {
      return sendError(res, 400, 'Binary file detected. Only text files can be read.', {
        path: path.relative(WORKSPACE_ROOT, filePath),
        size: stat.size,
      }, req);
    }

    const truncated = stat.size > MAX_FILE_SIZE;
    const content = fs.readFileSync(filePath, 'utf-8').substring(0, MAX_FILE_SIZE);

    res.json({
      path: path.relative(WORKSPACE_ROOT, filePath),
      content,
      size: stat.size,
      truncated,
      ...(truncated ? { warning: `File truncated to ${MAX_FILE_SIZE} bytes` } : {}),
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return sendError(res, 404, 'File not found', { path: req.query.path }, req);
    }
    log.error('File read error', err);
    sendError(res, 500, 'Failed to read file', null, req);
  }
});

/**
 * GET /files/list?path=relative/path&pattern=*.js
 * List directory contents
 */
router.get('/list', (req, res) => {
  const dirPath = resolveSafePath(req.query.path);

  if (!dirPath) {
    return sendError(res, 403, 'Path is outside workspace', null, req);
  }

  try {
    const stat = fs.statSync(dirPath);

    if (!stat.isDirectory()) {
      return sendError(res, 400, 'Path is not a directory. Use /files/read for files.', null, req);
    }

    let entries = fs.readdirSync(dirPath, { withFileTypes: true });

    // Filter by pattern if provided (simple glob: *.js, *.ts, etc.)
    const pattern = req.query.pattern;
    if (pattern) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
      );
      entries = entries.filter(e => regex.test(e.name));
    }

    // Filter out common noise
    const hidden = req.query.hidden === 'true';
    if (!hidden) {
      entries = entries.filter(e => !e.name.startsWith('.') || e.name === '.env.example');
    }

    const truncated = entries.length > MAX_DIR_ENTRIES;
    const result = entries.slice(0, MAX_DIR_ENTRIES).map(entry => {
      const entryPath = path.join(dirPath, entry.name);
      const info = { name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' };
      try {
        if (entry.isFile()) {
          info.size = fs.statSync(entryPath).size;
        }
      } catch { /* ignore stat errors */ }
      return info;
    });

    res.json({
      path: path.relative(WORKSPACE_ROOT, dirPath) || '.',
      entries: result,
      count: result.length,
      truncated,
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return sendError(res, 404, 'Directory not found', { path: req.query.path }, req);
    }
    log.error('Directory list error', err);
    sendError(res, 500, 'Failed to list directory', null, req);
  }
});

/**
 * GET /files/search?pattern=*.js&path=relative/dir
 * Recursively search for files by name pattern
 */
router.get('/search', (req, res) => {
  const pattern = req.query.pattern;
  if (!pattern) {
    return sendError(res, 400, 'pattern parameter is required', null, req);
  }

  const startPath = resolveSafePath(req.query.path);
  if (!startPath) {
    return sendError(res, 403, 'Path is outside workspace', null, req);
  }

  const regex = new RegExp(
    pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );

  const results = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

  function walk(dir, depth) {
    if (depth > 8 || results.length >= MAX_SEARCH_RESULTS) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= MAX_SEARCH_RESULTS) break;
        if (entry.name.startsWith('.') && entry.isDirectory()) continue;
        if (skipDirs.has(entry.name) && entry.isDirectory()) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && regex.test(entry.name)) {
          results.push({
            path: path.relative(WORKSPACE_ROOT, fullPath).replace(/\\/g, '/'),
            name: entry.name,
            size: fs.statSync(fullPath).size,
          });
        } else if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      }
    } catch { /* ignore permission errors */ }
  }

  walk(startPath, 0);

  res.json({
    pattern,
    startPath: path.relative(WORKSPACE_ROOT, startPath) || '.',
    results,
    count: results.length,
    truncated: results.length >= MAX_SEARCH_RESULTS,
  });
});

module.exports = router;
