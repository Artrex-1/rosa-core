'use strict';

const { Router } = require('express');
const taskEvents = require('../events/task-events');

const router = Router();

/**
 * GET /events/tasks
 *
 * Opens a Server-Sent Events stream.  The client stays connected and receives
 * real-time task events (task.created, task.claimed, task.completed, …).
 *
 * Auth: uses the same apiKeyAuth middleware as all other routes (applied in
 * server.js before this router is mounted).
 */
router.get('/tasks', (req, res) => {
  // Extra CORS headers for browser EventSource clients (the global cors()
  // middleware already handles OPTIONS pre-flight, but SSE streams need
  // explicit headers on the actual GET response too).
  const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:4242';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);

  const clientId = taskEvents.subscribe(res);

  // Clean up when the client disconnects (browser tab closed, network drop, …)
  req.on('close', () => {
    taskEvents.unsubscribe(clientId);
  });
});

module.exports = router;
