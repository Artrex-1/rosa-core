'use strict';

/**
 * Tests voor FTS5 error handling in rosa-core/src/routes/projects.js
 * - GET /projects/knowledge/search met malformed query geeft 400
 * - GET /projects/knowledge/search zonder q geeft 400
 * - GET /projects/knowledge/search met geldige query geeft 200
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.ROSA_DEV_MODE = 'true';
process.env.ROSA_API_KEY = 'test-key';

const TEST_DB_DIR = path.join(os.tmpdir(), `rosa-fts5-test-${process.pid}-${Date.now()}`);

function cleanupDb(dbPath) {
  ['', '-wal', '-shm'].forEach((ext) => {
    try { fs.unlinkSync(dbPath + ext); } catch (_) {}
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${urlPath}`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

let server;
let port;
let db;
let dbPath;

before(async () => {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  dbPath = path.join(TEST_DB_DIR, 'test.db');

  const Database = require('better-sqlite3');
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const { SCHEMA_SQL } = require('../src/db/schema');
  db.exec(SCHEMA_SQL);

  // Wis module cache voor schone state, daarna injecteer test DB
  delete require.cache[require.resolve('../src/db/database')];
  delete require.cache[require.resolve('../src/routes/projects')];

  const dbModule = require('../src/db/database');
  dbModule.getDatabase = () => db;

  const express = require('express');
  const projectRoutes = require('../src/routes/projects');
  const app = express();
  app.use(express.json());
  app.use('/projects', projectRoutes);
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: true, message: err.message });
  });

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(() => {
  server.close();
  if (db) db.close();
  cleanupDb(dbPath);
  try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('GET /projects/knowledge/search — FTS5 error handling', () => {
  it('geeft 400 wanneer q ontbreekt', async () => {
    const res = await get(port, '/projects/knowledge/search');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, true);
    assert.ok(res.body.message, 'message veld moet aanwezig zijn');
  });

  it('geeft 400 bij malformed FTS5 query (unclosed quote)', async () => {
    const malformed = encodeURIComponent('"unclosed');
    const res = await get(port, `/projects/knowledge/search?q=${malformed}`);
    assert.strictEqual(
      res.status, 400,
      `Verwacht 400, kreeg ${res.status}. Body: ${JSON.stringify(res.body)}`
    );
    assert.strictEqual(res.body.error, true);
    assert.ok(
      res.body.message.toLowerCase().includes('invalid') ||
      res.body.message.toLowerCase().includes('syntax') ||
      res.body.message.toLowerCase().includes('query'),
      `Message moet zoek-syntax fout beschrijven, kreeg: "${res.body.message}"`
    );
  });

  it('geeft 200 met lege results bij geldige query zonder treffer', async () => {
    const q = encodeURIComponent('querydatnietbestaatxyz123');
    const res = await get(port, `/projects/knowledge/search?q=${q}`);
    assert.strictEqual(res.status, 200, `Verwacht 200, kreeg ${res.status}. Body: ${JSON.stringify(res.body)}`);
    assert.ok(Array.isArray(res.body.results), 'results moet een array zijn');
    assert.strictEqual(res.body.count, 0);
  });

  it('geeft 200 met resultaten wanneer een treffer gevonden wordt', async () => {
    // Voeg een project + kennisitem toe via de DB direct
    const { v4: uuidv4 } = require('uuid');
    const projectId = uuidv4();

    db.prepare(`
      INSERT INTO projects (id, name, path, description) VALUES (?, ?, ?, ?)
    `).run(projectId, 'Test Project FTS5', '/tmp/test-fts5', 'Test omschrijving');

    db.prepare(`
      INSERT INTO knowledge (project_id, type, title, content, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectId, 'note', 'Unieke zoekterm titel', 'uniekfts5zoekterm inhoud', 'test');

    const q = encodeURIComponent('uniekfts5zoekterm');
    const res = await get(port, `/projects/knowledge/search?q=${q}`);
    assert.strictEqual(res.status, 200, `Verwacht 200, kreeg ${res.status}. Body: ${JSON.stringify(res.body)}`);
    assert.ok(Array.isArray(res.body.results));
    assert.ok(res.body.count >= 1, `Verwacht minstens 1 resultaat, kreeg ${res.body.count}`);
    assert.ok(res.body.results[0].project_name, 'project_name moet aanwezig zijn via JOIN');
  });
});
