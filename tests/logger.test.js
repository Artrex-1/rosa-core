'use strict';

/**
 * Unit tests voor rosa-core/src/utils/logger.js
 * Test: output format (JSON), levels, module-naam, ts veld, error-object extractie
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('logger (rosa-core)', () => {
  let capturedLog = [];
  let capturedWarn = [];
  let capturedError = [];

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  beforeEach(() => {
    capturedLog = [];
    capturedWarn = [];
    capturedError = [];
    console.log = (msg) => capturedLog.push(msg);
    console.warn = (msg) => capturedWarn.push(msg);
    console.error = (msg) => capturedError.push(msg);

    // Clear require cache so MODULE env var is re-evaluated
    delete require.cache[require.resolve('../src/utils/logger')];
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    delete require.cache[require.resolve('../src/utils/logger')];
  });

  it('logger.info schrijft geldige JSON naar stdout', () => {
    const log = require('../src/utils/logger');
    log.info('test bericht');

    assert.strictEqual(capturedLog.length, 1);
    const parsed = JSON.parse(capturedLog[0]);
    assert.strictEqual(parsed.level, 'info');
    assert.strictEqual(parsed.msg, 'test bericht');
    assert.ok(parsed.ts, 'ts veld moet aanwezig zijn');
    assert.ok(new Date(parsed.ts).getTime() > 0, 'ts moet geldige ISO datum zijn');
  });

  it('logger.warn schrijft geldige JSON naar stderr', () => {
    const log = require('../src/utils/logger');
    log.warn('waarschuwing');

    assert.strictEqual(capturedWarn.length, 1);
    const parsed = JSON.parse(capturedWarn[0]);
    assert.strictEqual(parsed.level, 'warn');
    assert.strictEqual(parsed.msg, 'waarschuwing');
  });

  it('logger.error schrijft geldige JSON naar stderr', () => {
    const log = require('../src/utils/logger');
    log.error('fout opgetreden', null);

    assert.strictEqual(capturedError.length, 1);
    const parsed = JSON.parse(capturedError[0]);
    assert.strictEqual(parsed.level, 'error');
    assert.strictEqual(parsed.msg, 'fout opgetreden');
  });

  it('logger.info slaat extra data mee in JSON', () => {
    const log = require('../src/utils/logger');
    log.info('request', { method: 'GET', path: '/health', status: 200 });

    const parsed = JSON.parse(capturedLog[0]);
    assert.strictEqual(parsed.method, 'GET');
    assert.strictEqual(parsed.path, '/health');
    assert.strictEqual(parsed.status, 200);
  });

  it('logger.error extraheert Error-object (message + stack)', () => {
    const log = require('../src/utils/logger');
    const err = new Error('iets kapot');
    log.error('crash', err);

    const parsed = JSON.parse(capturedError[0]);
    assert.strictEqual(parsed.error, 'iets kapot');
    assert.ok(parsed.stack, 'stack moet aanwezig zijn');
    assert.ok(parsed.stack.includes('Error: iets kapot'), 'stack moet error message bevatten');
  });

  it('logger.error behandelt non-Error waarde als error veld', () => {
    const log = require('../src/utils/logger');
    log.error('fout string', 'gewone string als error');

    const parsed = JSON.parse(capturedError[0]);
    assert.strictEqual(parsed.error, 'gewone string als error');
    assert.strictEqual(parsed.stack, undefined);
  });

  it('logger.error voegt extra data samen met error info', () => {
    const log = require('../src/utils/logger');
    const err = new Error('db fout');
    log.error('database crash', err, { requestId: 'abc123' });

    const parsed = JSON.parse(capturedError[0]);
    assert.strictEqual(parsed.requestId, 'abc123');
    assert.strictEqual(parsed.error, 'db fout');
  });

  it('module naam is "rosa-core" (default)', () => {
    delete process.env.ROSA_LOG_MODULE;
    const log = require('../src/utils/logger');
    log.info('check module');

    const parsed = JSON.parse(capturedLog[0]);
    assert.strictEqual(parsed.module, 'rosa-core');
  });

  it('module naam volgt ROSA_LOG_MODULE env var', () => {
    process.env.ROSA_LOG_MODULE = 'custom-module';
    const log = require('../src/utils/logger');
    log.info('check module');

    const parsed = JSON.parse(capturedLog[0]);
    assert.strictEqual(parsed.module, 'custom-module');
    delete process.env.ROSA_LOG_MODULE;
  });
});
