'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../db/database');
const { sendError } = require('../utils/error-response');

const router = Router();

// GET /projects - List all projects
router.get('/', (req, res) => {
  const db = getDatabase();
  const projects = db.prepare(`
    SELECT id, name, path, description, last_analyzed, created_at, updated_at
    FROM projects ORDER BY updated_at DESC
  `).all();

  res.json({ projects, count: projects.length });
});

// POST /projects - Create a new project
router.post('/', (req, res) => {
  const db = getDatabase();
  const { name, path: projectPath, description, metadata } = req.body;

  if (!name) {
    return sendError(res, 400, 'name is required', null, req);
  }
  if (name.length > 200) {
    return sendError(res, 400, 'name exceeds maximum length (200 chars)', null, req);
  }
  if (description && description.length > 5000) {
    return sendError(res, 400, 'description exceeds maximum length (5000 chars)', null, req);
  }

  const id = uuidv4();

  db.prepare(`
    INSERT INTO projects (id, name, path, description, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, projectPath || null, description || null,
    metadata ? JSON.stringify(metadata) : null);

  res.status(201).json({ id, name, path: projectPath });
});

// ========================
// Project Snapshots
// ========================

// GET /projects/snapshots - List all project snapshots
router.get('/snapshots', (req, res) => {
  const db = getDatabase();
  const snapshots = db.prepare('SELECT * FROM project_snapshots ORDER BY updated_at DESC').all();
  res.json(snapshots.map(parseSnapshotFields));
});

// GET /projects/snapshots/:project - Get snapshot for a specific project
router.get('/snapshots/:project', (req, res) => {
  const db = getDatabase();
  const snapshot = db.prepare('SELECT * FROM project_snapshots WHERE project = ?').get(req.params.project);
  if (!snapshot) return sendError(res, 404, 'Snapshot not found', null, req);
  res.json(parseSnapshotFields(snapshot));
});

// PUT /projects/snapshots/:project - Create or update a project snapshot
router.put('/snapshots/:project', (req, res) => {
  const { features_done, in_progress, next_up, key_decisions, open_questions } = req.body;
  const project = req.params.project;

  const arrayFields = { features_done, in_progress, next_up, key_decisions, open_questions };
  for (const [name, val] of Object.entries(arrayFields)) {
    if (val !== undefined && !Array.isArray(val)) {
      return sendError(res, 400, `${name} must be an array`, null, req);
    }
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM project_snapshots WHERE project = ?').get(project);

  if (existing) {
    db.prepare(`
      UPDATE project_snapshots SET
        features_done = COALESCE(?, features_done),
        in_progress = COALESCE(?, in_progress),
        next_up = COALESCE(?, next_up),
        key_decisions = COALESCE(?, key_decisions),
        open_questions = COALESCE(?, open_questions),
        updated_at = CURRENT_TIMESTAMP
      WHERE project = ?
    `).run(
      features_done ? JSON.stringify(features_done) : null,
      in_progress ? JSON.stringify(in_progress) : null,
      next_up ? JSON.stringify(next_up) : null,
      key_decisions ? JSON.stringify(key_decisions) : null,
      open_questions ? JSON.stringify(open_questions) : null,
      project
    );
  } else {
    db.prepare(`
      INSERT INTO project_snapshots (project, features_done, in_progress, next_up, key_decisions, open_questions)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      project,
      JSON.stringify(features_done || []),
      JSON.stringify(in_progress || []),
      JSON.stringify(next_up || []),
      JSON.stringify(key_decisions || []),
      JSON.stringify(open_questions || [])
    );
  }

  const snapshot = db.prepare('SELECT * FROM project_snapshots WHERE project = ?').get(project);
  res.status(existing ? 200 : 201).json(parseSnapshotFields(snapshot));
});

// ========================
// Project CRUD & Knowledge
// ========================

// GET /projects/:project_id/context - Get project knowledge
router.get('/:project_id/context', (req, res) => {
  const db = getDatabase();
  const { project_id } = req.params;
  const type = req.query.type;

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(project_id);
  if (!project) {
    return sendError(res, 404, 'Project not found', null, req);
  }

  project.metadata = project.metadata ? JSON.parse(project.metadata) : null;

  let knowledgeQuery = `
    SELECT id, type, title, content, tags, source, created_at
    FROM knowledge WHERE project_id = ?
  `;
  const params = [project_id];

  if (type) {
    knowledgeQuery += ' AND type = ?';
    params.push(type);
  }

  knowledgeQuery += ' ORDER BY created_at DESC';

  const knowledge = db.prepare(knowledgeQuery).all(...params);

  // Get related tasks (escape LIKE wildcards in project_id)
  const escapedProjectId = project_id.replace(/[%_\\]/g, '\\$&');
  const tasks = db.prepare(`
    SELECT id, type, title, status, created_at
    FROM tasks
    WHERE payload LIKE ? ESCAPE '\\'
    ORDER BY created_at DESC
    LIMIT 10
  `).all(`%${escapedProjectId}%`);

  res.json({ project, knowledge, tasks });
});

// POST /projects/analyze - Start project analysis (creates a task)
router.post('/analyze', (req, res) => {
  const db = getDatabase();
  const { project_id, analysis_type } = req.body;

  if (!project_id) {
    return sendError(res, 400, 'project_id is required', null, req);
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(project_id);
  if (!project) {
    return sendError(res, 404, 'Project not found', null, req);
  }

  // Create an analysis task for laptop-Rosa
  const taskId = uuidv4();
  db.prepare(`
    INSERT INTO tasks (id, type, title, description, payload, created_by, assigned_to)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    'project_analysis',
    `Analyze project: ${project.name}`,
    `Run ${analysis_type || 'full'} analysis on project ${project.name}`,
    JSON.stringify({ project_id, project_path: project.path, analysis_type: analysis_type || 'full' }),
    req.clientId || 'api',
    'laptop-rosa'
  );

  res.status(201).json({
    task_id: taskId,
    project_id,
    status: 'pending',
    message: `Analysis task created for ${project.name}`,
  });
});

// POST /projects/:project_id/knowledge - Add knowledge to a project
router.post('/:project_id/knowledge', (req, res) => {
  const db = getDatabase();
  const { project_id } = req.params;
  const { type, title, content, tags, source } = req.body;

  if (!type || !content) {
    return sendError(res, 400, 'type and content are required', null, req);
  }

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(project_id);
  if (!project) {
    return sendError(res, 404, 'Project not found', null, req);
  }

  const result = db.prepare(`
    INSERT INTO knowledge (project_id, type, title, content, tags, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    project_id, type, title || null, content,
    Array.isArray(tags) ? tags.join(',') : (tags || null),
    source || req.clientId || 'unknown'
  );

  res.status(201).json({ id: result.lastInsertRowid, project_id, type });
});

// GET /projects/knowledge/search - Full-text search across knowledge
router.get('/knowledge/search', (req, res) => {
  const db = getDatabase();
  const { q, project_id, type, limit: rawLimit } = req.query;
  const limit = Math.min(parseInt(rawLimit) || 20, 200);

  if (!q) {
    return sendError(res, 400, 'q (query) parameter is required', null, req);
  }

  // Use FTS5 for search
  let query = `
    SELECT k.id, k.project_id, k.type, k.title, k.content, k.tags, k.source, k.created_at,
           p.name as project_name
    FROM knowledge_fts fts
    JOIN knowledge k ON k.id = fts.rowid
    LEFT JOIN projects p ON p.id = k.project_id
    WHERE knowledge_fts MATCH ?
  `;
  const params = [q];

  if (project_id) {
    query += ' AND k.project_id = ?';
    params.push(project_id);
  }
  if (type) {
    query += ' AND k.type = ?';
    params.push(type);
  }

  query += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  try {
    const results = db.prepare(query).all(...params);
    res.json({ results, count: results.length });
  } catch (err) {
    // FTS5 MATCH throws on malformed query syntax.
    // Error messages vary: "fts5: syntax error", "unterminated string", etc.
    // All originate from the MATCH operator so we always return 400.
    return sendError(res, 400, 'Invalid search query syntax', null, req);
  }
});

// ========================
// Helpers
// ========================

function parseSnapshotFields(snapshot) {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    features_done: safeJsonParse(snapshot.features_done),
    in_progress: safeJsonParse(snapshot.in_progress),
    next_up: safeJsonParse(snapshot.next_up),
    key_decisions: safeJsonParse(snapshot.key_decisions),
    open_questions: safeJsonParse(snapshot.open_questions),
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}

module.exports = router;
