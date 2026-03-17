'use strict';

const { Router } = require('express');
const { getDatabase } = require('../db/database');
const { apiKeyAuth } = require('../middleware/auth');

const router = Router();

// GET /health - Public health check (minimal info for unauthenticated callers)
router.get('/', (req, res) => {
  const db = getDatabase();
  let dbOk = false;

  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch (e) {
    // db not ok
  }

  const status = dbOk ? 'healthy' : 'degraded';

  // Only return status — no version, uptime, or DB details to unauthenticated callers
  res.status(dbOk ? 200 : 503).json({ status });
});

// GET /health/details - Authenticated detailed health check
router.get('/details', apiKeyAuth, (req, res) => {
  const db = getDatabase();
  let dbOk = false;

  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch (e) {
    // db not ok
  }

  const status = dbOk ? 'healthy' : 'degraded';

  res.status(dbOk ? 200 : 503).json({
    status,
    version: require('../../package.json').version,
    uptime: process.uptime(),
    database: dbOk ? 'connected' : 'error',
    timestamp: new Date().toISOString(),
  });
});

// GET /health/stats - Database statistics (requires auth)
router.get('/stats', apiKeyAuth, (req, res) => {
  const db = getDatabase();

  const conversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
  const tasks = db.prepare(`
    SELECT status, COUNT(*) as count FROM tasks GROUP BY status
  `).all();
  const projects = db.prepare('SELECT COUNT(*) as count FROM projects').get();
  const knowledge = db.prepare('SELECT COUNT(*) as count FROM knowledge').get();
  const sessions = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE active = 1').get();

  res.json({
    conversations: conversations.count,
    tasks: Object.fromEntries(tasks.map(t => [t.status, t.count])),
    projects: projects.count,
    knowledge: knowledge.count,
    active_sessions: sessions.count,
  });
});

module.exports = router;
