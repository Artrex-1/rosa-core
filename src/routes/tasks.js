'use strict';

const { Router } = require('express');
const http = require('http');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../db/database');
const taskEvents = require('../events/task-events');
const log = require('../utils/logger');
const { sendError } = require('../utils/error-response');

const router = Router();

const KNOWN_AGENTS = ['nora', 'luna', 'mila', 'sara', 'vera', 'rosa', 'claude', 'laptop-rosa'];
const TASK_WEBHOOK_URL = process.env.TASK_WEBHOOK_URL || '';

// SSRF validation — validate webhook URL at startup, not per-request
if (TASK_WEBHOOK_URL) {
  try {
    const parsed = new URL(TASK_WEBHOOK_URL);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      log.error('TASK_WEBHOOK_URL has invalid protocol', null, { protocol: parsed.protocol });
      process.exit(1);
    }
    const blockedHosts = ['169.254.169.254', '0.0.0.0', 'metadata.google.internal'];
    if (blockedHosts.includes(parsed.hostname)) {
      log.error('TASK_WEBHOOK_URL points to blocked host', null, { hostname: parsed.hostname });
      process.exit(1);
    }
  } catch (e) {
    log.error('TASK_WEBHOOK_URL is not a valid URL', e, { url: TASK_WEBHOOK_URL });
    process.exit(1);
  }
}

/**
 * Fire a webhook notification when a task is completed/failed.
 * Non-blocking: errors are logged but never throw.
 */
function fireWebhook(task) {
  if (!TASK_WEBHOOK_URL) return;

  const payload = JSON.stringify(task);
  const url = new URL(TASK_WEBHOOK_URL);
  const lib = url.protocol === 'https:' ? https : http;

  const secret = process.env.TASK_WEBHOOK_SECRET;
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  };
  if (secret) {
    headers['x-webhook-secret'] = secret;
  }

  const req = lib.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers,
  }, (res) => {
    res.resume(); // drain response
    if (res.statusCode >= 400) {
      log.warn('Webhook response error', { url: TASK_WEBHOOK_URL, status: res.statusCode });
    }
  });

  req.on('error', (err) => {
    log.error('Webhook notification failed', err, { url: TASK_WEBHOOK_URL });
  });

  req.setTimeout(5000, () => {
    req.destroy();
    log.warn('Webhook timeout', { url: TASK_WEBHOOK_URL });
  });

  req.write(payload);
  req.end();
}

// POST /tasks/create - Create a new task
router.post('/create', (req, res) => {
  const db = getDatabase();
  const { type, title, description, payload, priority, assigned_to } = req.body;

  if (!type || !title) {
    return sendError(res, 400, 'type and title are required', null, req);
  }

  if (title.length > 500) {
    return sendError(res, 400, 'title exceeds maximum length (500 chars)', null, req);
  }
  if (description && description.length > 10000) {
    return sendError(res, 400, 'description exceeds maximum length (10000 chars)', null, req);
  }
  if (assigned_to && !KNOWN_AGENTS.includes(assigned_to.toLowerCase())) {
    return sendError(res, 400, `Unknown agent: ${assigned_to}. Must be one of: ${KNOWN_AGENTS.join(', ')}`, null, req);
  }

  const id = uuidv4();
  const created_by = req.clientId || 'unknown';

  db.prepare(`
    INSERT INTO tasks (id, type, title, description, payload, priority, created_by, assigned_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, type, title,
    description || null,
    payload ? JSON.stringify(payload) : null,
    priority || 0,
    created_by,
    assigned_to || null
  );

  const createdTask = {
    id,
    type,
    title,
    status: 'pending',
    created_by,
    assigned_to: assigned_to || null,
    payload: payload || null,
    updated_at: new Date().toISOString(),
  };

  res.status(201).json(createdTask);

  // Emit SSE event (non-blocking, after response sent)
  taskEvents.emit('task.created', createdTask);
});

// GET /tasks/pending - Get pending tasks (optionally filtered by assigned_to)
router.get('/pending', (req, res) => {
  const db = getDatabase();
  const { assigned_to } = req.query;

  let query = `
    SELECT id, type, title, description, payload, status, priority,
           created_by, assigned_to, created_at, updated_at
    FROM tasks
    WHERE status IN ('pending', 'in_progress')
  `;
  const params = [];

  if (assigned_to) {
    query += ' AND assigned_to = ?';
    params.push(assigned_to);
  }

  query += ' ORDER BY priority DESC, created_at ASC';

  const tasks = db.prepare(query).all(...params).map(t => ({
    ...t,
    payload: t.payload ? JSON.parse(t.payload) : null,
  }));

  res.json({ tasks, count: tasks.length });
});

// GET /tasks/:id - Get a specific task
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);

  if (!task) {
    return sendError(res, 404, 'Task not found', null, req);
  }

  task.payload = task.payload ? JSON.parse(task.payload) : null;
  task.result = task.result ? JSON.parse(task.result) : null;
  res.json(task);
});

// POST /tasks/complete - Mark task as completed
router.post('/complete', (req, res) => {
  const db = getDatabase();
  const { id, result } = req.body;

  if (!id) {
    return sendError(res, 400, 'id is required', null, req);
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) {
    return sendError(res, 404, 'Task not found', null, req);
  }

  // Determine status from result: if result.success is explicitly false, mark as failed
  const finalStatus = (result && result.success === false) ? 'failed' : 'completed';

  db.prepare(`
    UPDATE tasks
    SET status = ?,
        result = ?,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(finalStatus, result ? JSON.stringify(result) : null, id);

  res.json({ id, status: finalStatus });

  // Fire webhook + SSE event with full task data (non-blocking, after response)
  const completedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (completedTask) {
    completedTask.payload = completedTask.payload ? JSON.parse(completedTask.payload) : null;
    completedTask.result = completedTask.result ? JSON.parse(completedTask.result) : null;
    fireWebhook(completedTask);
    taskEvents.emit(finalStatus === 'failed' ? 'task.failed' : 'task.completed', completedTask);
  }
});

// PATCH /tasks/:id/status - Update task status
router.patch('/:id/status', (req, res) => {
  const db = getDatabase();
  const { status } = req.body;
  const validStatuses = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'];

  if (!status || !validStatuses.includes(status)) {
    return sendError(res, 400, `status must be one of: ${validStatuses.join(', ')}`, null, req);
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    return sendError(res, 404, 'Task not found', null, req);
  }

  if (status === 'completed') {
    db.prepare(`
      UPDATE tasks SET status = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, req.params.id);
  } else {
    db.prepare(`
      UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, req.params.id);
  }

  res.json({ id: req.params.id, status });

  // Emit SSE events (non-blocking, after response sent)
  const updatedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (updatedTask) {
    updatedTask.payload = updatedTask.payload ? JSON.parse(updatedTask.payload) : null;
    updatedTask.result = updatedTask.result ? JSON.parse(updatedTask.result) : null;

    taskEvents.emit('task.status_changed', updatedTask);

    if (status === 'in_progress') {
      taskEvents.emit('task.claimed', updatedTask);
    } else if (status === 'failed') {
      taskEvents.emit('task.failed', updatedTask);
    }

    if (['in_progress', 'failed', 'completed'].includes(status)) {
      fireWebhook(updatedTask);
    }
  }
});

// GET /tasks/history - Get completed/failed tasks (or all tasks for a specific agent)
router.get('/list/history', (req, res) => {
  const db = getDatabase();
  const { assigned_to } = req.query;

  let tasks;
  if (assigned_to) {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    tasks = db.prepare(`
      SELECT id, type, title, status, created_by, assigned_to,
             created_at, updated_at, completed_at
      FROM tasks
      WHERE assigned_to = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(assigned_to, limit);
  } else {
    const limit = Math.min(parseInt(req.query.limit) || 20, 200);
    tasks = db.prepare(`
      SELECT id, type, title, status, created_by, assigned_to,
             created_at, completed_at
      FROM tasks
      WHERE status IN ('completed', 'failed', 'cancelled')
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(limit);
  }

  res.json({ tasks, count: tasks.length });
});

module.exports = router;
