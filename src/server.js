'use strict';

require('dotenv').config();

const log = require('./utils/logger');

// --- Startup env validation ---
const REQUIRED_ENV = ['ROSA_API_KEY'];
const OPTIONAL_ENV = ['TASK_WEBHOOK_URL', 'ROSA_DEV_MODE'];

const missingRequired = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingRequired.length > 0 && process.env.ROSA_DEV_MODE !== 'true') {
  log.error('Missing required environment variables', null, { missing: missingRequired });
  process.exit(1);
}

for (const key of OPTIONAL_ENV) {
  if (!process.env[key]) {
    log.warn(`Optional env var ${key} is not set`);
  }
}

const Sentry = require('@sentry/node');
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: 0.2,
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { apiKeyAuth } = require('./middleware/auth');
const { getDatabase, closeDatabase } = require('./db/database');

const memoryRoutes = require('./routes/memory');
const taskRoutes = require('./routes/tasks');
const projectRoutes = require('./routes/projects');
const healthRoutes = require('./routes/health');
const fileRoutes = require('./routes/files');
const { router: learningRoutes, seedDefaultLessons } = require('./routes/learning');
const eventRoutes = require('./routes/events');
const agentRoutes = require('./routes/agents');
const taskEvents = require('./events/task-events');

const app = express();
const PORT = process.env.PORT || 3100;

// Security headers
app.use(helmet());

// CORS — restrict to configured origins (default: dashboard only)
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:4242').split(',').map(s => s.trim());
app.use(cors({ origin: CORS_ORIGINS, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));

// Rate limiting — 100 requests per minute per IP
app.use(rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
}));

// Body parser with reduced limit (256KB is plenty for this API)
app.use(express.json({ limit: '256kb' }));

// Request ID for log correlation
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('x-request-id', req.id);
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    log.info('request', {
      requestId: req.id.slice(0, 8),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: Date.now() - start,
    });
  });
  next();
});

// Health endpoint (no auth required)
app.use('/health', healthRoutes);

// API key auth for all other routes
app.use(apiKeyAuth);

// Routes
app.use('/memory', memoryRoutes);
app.use('/tasks', taskRoutes);
app.use('/projects', projectRoutes);
app.use('/files', fileRoutes);
app.use('/learning', learningRoutes);
app.use('/events', eventRoutes);
app.use('/agents', agentRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: true, message: 'Not found' });
});

// Error handler
Sentry.setupExpressErrorHandler(app);

app.use((err, req, res, _next) => {
  log.error('Unhandled error', err, { requestId: req.id });
  res.status(500).json({ error: true, message: 'Internal server error' });
});

// Initialize database on startup and seed default lessons
const _db = getDatabase();
seedDefaultLessons(_db);

const server = app.listen(PORT, () => {
  log.info('Rosa-Core API started', { port: PORT, version: '1.0.0' });

  // Global SSE heartbeat: send a keep-alive comment every 30 s to all clients.
  // Each client also has its own per-connection timer, but this central one
  // ensures the interval continues even if individual timers drift.
  setInterval(() => {
    if (taskEvents.clientCount > 0) {
      taskEvents.heartbeat();
    }
  }, 30_000);
});

// Graceful shutdown
function shutdown(signal) {
  log.info('Shutting down', { signal });
  // End all open SSE streams so Node can close the HTTP server cleanly
  taskEvents.emit('server.shutdown', { timestamp: new Date().toISOString() });
  server.close(() => {
    closeDatabase();
    log.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
