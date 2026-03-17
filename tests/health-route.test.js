'use strict';

/**
 * Integratie tests voor rosa-core health endpoints.
 *
 * Test: /health (publiek, minimaal), /health/details (auth vereist),
 *       /health/stats (auth vereist), foutscenario's (geen auth, verkeerde key).
 *
 * Strategie: we bouwen een minimale Express-app met de health router en fake DB,
 * starten die op een random poort, doen echte HTTP requests.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Stel dev-mode en api-keys in VOOR module-loads, zodat server.js niet crash
process.env.ROSA_DEV_MODE = 'true';
process.env.API_KEYS = 'test-valid-key';
process.env.ROSA_API_KEY = 'test-valid-key'; // voor startup validation in server.js

// Overschrijf DB pad naar een temp-db zodat we niet de productie-db raken
const tmpDb = path.join(os.tmpdir(), `health-test-${process.pid}-${Date.now()}.db`);

// Patch database module vóór import zodat tests een temp-db gebruiken
process.env.ROSA_TEST_DB_PATH = tmpDb;

// We bouwen een STANDALONE Express-app met alleen de health router en auth middleware.
// Zo vermijden we de startup-validatie, Sentry-init en database singleton van server.js.
const express = require('/Users/arthurstam/Workspace/smarthome/rosa-core/node_modules/express');
const { apiKeyAuth } = require('../src/middleware/auth');

// Database singleton opzetten
const Database = require('/Users/arthurstam/Workspace/smarthome/rosa-core/node_modules/better-sqlite3');
const { SCHEMA_SQL } = require('../src/db/schema');

let testDb;

function setupTestDb() {
  testDb = new Database(tmpDb);
  testDb.pragma('journal_mode = DELETE');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA_SQL);
}

// Monkey-patch getDatabase zodat health route onze test-db gebruikt
const dbModule = require('../src/db/database');
function patchDatabase() {
  dbModule._origGetDatabase = dbModule.getDatabase;
  // Overschrijf via module cache hack
  const mod = require.cache[require.resolve('../src/db/database')];
  mod.exports.getDatabase = () => testDb;
}

function restoreDatabase() {
  const mod = require.cache[require.resolve('../src/db/database')];
  if (mod && mod.exports._origGetDatabase) {
    mod.exports.getDatabase = mod.exports._origGetDatabase;
  }
}

// HTTP helper
function request(port, method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers,
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Health endpoints', () => {
  let server;
  let port;

  before((_, done) => {
    setupTestDb();
    patchDatabase();

    const app = express();

    // Health router vereist dat getDatabase werkt
    const healthRouter = require('../src/routes/health');
    app.use('/health', healthRouter);

    // 401 fallback voor andere routes
    app.use((req, res) => res.status(404).json({ error: true, message: 'Not found' }));

    server = app.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  after((_, done) => {
    restoreDatabase();
    server.close(() => {
      if (testDb) { try { testDb.close(); } catch {} }
      ['', '-wal', '-shm'].forEach(ext => { try { fs.unlinkSync(tmpDb + ext); } catch {} });
      done();
    });
  });

  // --- /health (publiek) ---

  it('GET /health antwoordt 200 zonder auth', async () => {
    const res = await request(port, 'GET', '/health');
    assert.strictEqual(res.status, 200);
  });

  it('GET /health geeft alleen {status} terug (geen versie, geen uptime)', async () => {
    const res = await request(port, 'GET', '/health');
    assert.strictEqual(res.body.status, 'healthy');
    // Expliciet: versie en uptime mogen NIET in de publieke response zitten
    assert.strictEqual(res.body.version, undefined, 'version mag niet publiek zichtbaar zijn');
    assert.strictEqual(res.body.uptime, undefined, 'uptime mag niet publiek zichtbaar zijn');
    assert.strictEqual(res.body.database, undefined, 'database mag niet publiek zichtbaar zijn');
  });

  // --- /health/details (auth vereist) ---

  it('GET /health/details zonder API key geeft 401', async () => {
    const res = await request(port, 'GET', '/health/details');
    assert.strictEqual(res.status, 401);
  });

  it('GET /health/details met verkeerde key geeft 401', async () => {
    const res = await request(port, 'GET', '/health/details', { 'x-api-key': 'verkeerde-key' });
    assert.strictEqual(res.status, 401);
  });

  it('GET /health/details met geldige key antwoordt 200', async () => {
    const res = await request(port, 'GET', '/health/details', { 'x-api-key': 'test-valid-key' });
    assert.strictEqual(res.status, 200);
  });

  it('GET /health/details met geldige key bevat versie, uptime, database, timestamp', async () => {
    const res = await request(port, 'GET', '/health/details', { 'x-api-key': 'test-valid-key' });
    assert.ok(res.body.version, 'versie moet aanwezig zijn');
    assert.strictEqual(typeof res.body.uptime, 'number', 'uptime moet een getal zijn');
    assert.strictEqual(res.body.database, 'connected');
    assert.ok(res.body.timestamp, 'timestamp moet aanwezig zijn');
    assert.ok(new Date(res.body.timestamp).getTime() > 0);
  });

  it('GET /health/details bevat status:healthy bij werkende DB', async () => {
    const res = await request(port, 'GET', '/health/details', { 'x-api-key': 'test-valid-key' });
    assert.strictEqual(res.body.status, 'healthy');
  });

  // --- /health/stats (auth vereist) ---

  it('GET /health/stats zonder API key geeft 401', async () => {
    const res = await request(port, 'GET', '/health/stats');
    assert.strictEqual(res.status, 401);
  });

  it('GET /health/stats met geldige key antwoordt 200', async () => {
    const res = await request(port, 'GET', '/health/stats', { 'x-api-key': 'test-valid-key' });
    assert.strictEqual(res.status, 200);
  });

  it('GET /health/stats response bevat verwachte tellers', async () => {
    const res = await request(port, 'GET', '/health/stats', { 'x-api-key': 'test-valid-key' });
    assert.strictEqual(typeof res.body.conversations, 'number');
    assert.strictEqual(typeof res.body.projects, 'number');
    assert.strictEqual(typeof res.body.knowledge, 'number');
    assert.strictEqual(typeof res.body.active_sessions, 'number');
    assert.ok('tasks' in res.body, 'tasks object moet aanwezig zijn');
  });
});
