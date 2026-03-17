'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../db/database');
const { sendError } = require('../utils/error-response');

const router = Router();

// POST /memory/store - Store conversation/knowledge
router.post('/store', (req, res) => {
  const db = getDatabase();
  const { user_id, role, content, session_id, source } = req.body;

  if (!user_id || !role || !content) {
    return sendError(res, 400, 'user_id, role, and content are required', null, req);
  }
  if (user_id.length > 100) {
    return sendError(res, 400, 'user_id exceeds maximum length (100 chars)', null, req);
  }
  if (content.length > 50000) {
    return sendError(res, 400, 'content exceeds maximum length (50000 chars)', null, req);
  }

  const sid = session_id || null;
  const src = source || req.clientId || 'unknown';

  const stmt = db.prepare(`
    INSERT INTO conversations (user_id, role, content, session_id, source)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(user_id, role, content, sid, src);

  // Update session last_active if session exists
  if (sid) {
    db.prepare(`
      UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?
    `).run(sid);
  }

  res.status(201).json({
    id: result.lastInsertRowid,
    session_id: sid,
    stored: true,
  });
});

// POST /memory/store/batch - Store multiple messages at once
router.post('/store/batch', (req, res) => {
  const db = getDatabase();
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return sendError(res, 400, 'messages array is required', null, req);
  }
  if (messages.length > 100) {
    return sendError(res, 400, 'Maximum 100 messages per batch', null, req);
  }

  const stmt = db.prepare(`
    INSERT INTO conversations (user_id, role, content, session_id, source)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((msgs) => {
    const ids = [];
    for (const msg of msgs) {
      const result = stmt.run(
        msg.user_id, msg.role, msg.content,
        msg.session_id || null, msg.source || req.clientId || 'unknown'
      );
      ids.push(result.lastInsertRowid);
    }
    return ids;
  });

  const ids = insertMany(messages);
  res.status(201).json({ stored: ids.length, ids });
});

// GET /memory/context/:session_id - Get context for a session
router.get('/context/:session_id', (req, res) => {
  const db = getDatabase();
  const { session_id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  // Get session info
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session_id);

  // Get conversation history
  const messages = db.prepare(`
    SELECT id, user_id, role, content, source, timestamp
    FROM conversations
    WHERE session_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(session_id, limit).reverse();

  res.json({
    session: session || null,
    messages,
    count: messages.length,
  });
});

// GET /memory/history/:user_id - Get user conversation history
router.get('/history/:user_id', (req, res) => {
  const db = getDatabase();
  const { user_id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 200);
  const source = req.query.source;

  let query = `
    SELECT id, role, content, session_id, source, timestamp
    FROM conversations WHERE user_id = ?
  `;
  const params = [user_id];

  if (source) {
    query += ' AND source = ?';
    params.push(source);
  }

  query += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  const messages = db.prepare(query).all(...params).reverse();
  res.json({ messages, count: messages.length });
});

// POST /memory/session - Create or get a session
router.post('/session', (req, res) => {
  const db = getDatabase();
  const { user_id, source, context } = req.body;

  if (!user_id) {
    return sendError(res, 400, 'user_id is required', null, req);
  }

  const id = uuidv4();
  const src = source || req.clientId || 'unknown';

  db.prepare(`
    INSERT INTO sessions (id, user_id, source, context)
    VALUES (?, ?, ?, ?)
  `).run(id, user_id, src, context ? JSON.stringify(context) : null);

  res.status(201).json({ id, user_id, source: src });
});

// DELETE /memory/session/:session_id - Close a session
router.delete('/session/:session_id', (req, res) => {
  const db = getDatabase();
  const result = db.prepare(
    'UPDATE sessions SET active = 0 WHERE id = ?'
  ).run(req.params.session_id);

  res.json({ closed: result.changes > 0 });
});

// GET /memory/search - Search across conversations
router.get('/search', (req, res) => {
  const db = getDatabase();
  const { q, user_id, limit: rawLimit } = req.query;
  const limit = Math.min(parseInt(rawLimit) || 20, 200);

  if (!q) {
    return sendError(res, 400, 'q (query) parameter is required', null, req);
  }

  // Escape SQL LIKE wildcards in user input to prevent LIKE injection
  const escapedQ = q.replace(/[%_\\]/g, '\\$&');

  let query = `
    SELECT id, user_id, role, content, session_id, source, timestamp
    FROM conversations
    WHERE content LIKE ? ESCAPE '\\'
  `;
  const params = [`%${escapedQ}%`];

  if (user_id) {
    query += ' AND user_id = ?';
    params.push(user_id);
  }

  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const results = db.prepare(query).all(...params);
  res.json({ results, count: results.length });
});

// ========================
// Structured Memory Items (key-value with project tagging)
// ========================

// POST /memory - Store a structured memory item (upsert)
router.post('/', (req, res) => {
  const db = getDatabase();
  const { key, value, context, project } = req.body;

  if (!key || !value) {
    return sendError(res, 400, 'key and value are required', null, req);
  }

  const existing = db.prepare('SELECT id FROM memory_items WHERE key = ?').get(key);

  if (existing) {
    db.prepare(
      'UPDATE memory_items SET value = ?, context = ?, project = COALESCE(?, project), updated_at = CURRENT_TIMESTAMP WHERE key = ?'
    ).run(value, context || null, project || null, key);
  } else {
    db.prepare(
      'INSERT INTO memory_items (key, value, context, project) VALUES (?, ?, ?, ?)'
    ).run(key, value, context || null, project || null);
  }

  const item = db.prepare('SELECT * FROM memory_items WHERE key = ?').get(key);
  res.status(existing ? 200 : 201).json(item);
});

// GET /memory/items - List memory items, optionally filtered by project
router.get('/items', (req, res) => {
  const db = getDatabase();
  const { project, limit: rawLimit } = req.query;
  const limit = Math.min(parseInt(rawLimit) || 20, 200);

  let query, params;
  if (project) {
    query = 'SELECT * FROM memory_items WHERE project = ? ORDER BY updated_at DESC LIMIT ?';
    params = [project, limit];
  } else {
    query = 'SELECT * FROM memory_items ORDER BY updated_at DESC LIMIT ?';
    params = [limit];
  }

  const items = db.prepare(query).all(...params);
  res.json(items);
});

// DELETE /memory/item/:key - Delete a memory item
router.delete('/item/:key', (req, res) => {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM memory_items WHERE key = ?').run(req.params.key);
  if (result.changes === 0) return sendError(res, 404, 'Memory item not found', null, req);
  res.json({ success: true });
});

module.exports = router;
