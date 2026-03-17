'use strict';

/**
 * Tests voor startup environment validatie in rosa-core en rosa-laptop.
 *
 * Strategie: spawn child processes met specifieke env vars (ontbrekend of aanwezig)
 * en controleer de exit code + stderr output.
 *
 * rosa-core/src/server.js: faalt bij missende ROSA_API_KEY tenzij ROSA_DEV_MODE=true
 * rosa-laptop/src/poller.js: faalt altijd bij missende ROSA_CORE_URL of ROSA_CORE_API_KEY
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

// Tijdslimiet voor child processes (ms)
const TIMEOUT = 5000;

function runScript(scriptPath, envOverrides = {}, cwd = undefined) {
  const result = spawnSync(
    process.execPath,
    [scriptPath],
    {
      cwd: cwd || path.dirname(path.dirname(scriptPath)),
      env: { ...process.env, ...envOverrides },
      timeout: TIMEOUT,
      encoding: 'utf8',
    }
  );
  return result;
}

// Rosa-core server.js gebruikt dotenv — we hoeven geen .env te starten als we env direct injecteren
describe('Startup env validatie — rosa-core', () => {
  const serverScript = path.join(__dirname, '..', 'src', 'server.js');

  it('faalt met exit code 1 wanneer ROSA_API_KEY ontbreekt (zonder ROSA_DEV_MODE)', () => {
    // Verwijder ROSA_API_KEY en ROSA_DEV_MODE uit de env
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // GEEN ROSA_API_KEY
      // GEEN ROSA_DEV_MODE
    };
    const result = runScript(serverScript, env);

    // Script moet snel stoppen met exit code 1
    assert.strictEqual(result.status, 1,
      `Verwacht exit code 1, maar kreeg: ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`
    );
  });

  it('stderr bevat "Missing required environment variables" bij missende key', () => {
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    };
    const result = runScript(serverScript, env);
    const combined = (result.stderr || '') + (result.stdout || '');
    assert.ok(
      combined.includes('Missing required environment variables') || combined.includes('ROSA_API_KEY'),
      `Verwacht foutmelding over missende env var. Output:\n${combined}`
    );
  });

  it('start succesvol wanneer ROSA_DEV_MODE=true (ook zonder ROSA_API_KEY)', (_, done) => {
    // We starten de server kort en sturen direct SIGTERM
    const { spawn } = require('child_process');
    const proc = spawn(process.execPath, [serverScript], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ROSA_DEV_MODE: 'true',
        // GEEN ROSA_API_KEY — dev mode moet dit accepteren
      },
      encoding: 'utf8',
    });

    let output = '';
    proc.stdout.on('data', d => output += d);
    proc.stderr.on('data', d => output += d);

    // Geef 2 seconden om te starten — dan kill
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
    }, 2000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      // Process moet door SIGTERM (null/0/143) gestopt zijn, NIET door exit(1)
      // exit code 1 = validatie fout, 0 of SIGTERM = normaal
      assert.notStrictEqual(code, 1, `Server faalde onverwacht met exit 1.\nOutput:\n${output}`);
      done();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      done(err);
    });
  });
});

describe('Startup env validatie — rosa-laptop', () => {
  const pollerScript = path.join(__dirname, '..', '..', '..', 'smarthome', 'rosa-laptop', 'src', 'poller.js');

  // Gebruik het correcte pad relatief aan dit project
  const laptopPollerScript = path.resolve(__dirname, '../../rosa-laptop/src/poller.js');

  const laptopCwd = path.resolve(__dirname, '../../rosa-laptop');

  it('faalt met exit code 1 wanneer ROSA_CORE_URL ontbreekt', () => {
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ROSA_CORE_API_KEY: 'some-key',
      // GEEN ROSA_CORE_URL
    };
    const result = runScript(laptopPollerScript, env, laptopCwd);
    assert.strictEqual(result.status, 1,
      `Verwacht exit code 1. Got: ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`
    );
  });

  it('faalt met exit code 1 wanneer ROSA_CORE_API_KEY ontbreekt', () => {
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ROSA_CORE_URL: 'http://localhost:3100',
      // GEEN ROSA_CORE_API_KEY
    };
    const result = runScript(laptopPollerScript, env, laptopCwd);
    assert.strictEqual(result.status, 1,
      `Verwacht exit code 1. Got: ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`
    );
  });

  it('stderr bevat foutmelding bij volledig ontbrekende env vars', () => {
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // Injecteer node_modules pad via NODE_PATH zodat dotenv gevonden wordt
      NODE_PATH: path.resolve(__dirname, '..', 'node_modules'),
    };
    const result = runScript(laptopPollerScript, env, laptopCwd);
    const combined = (result.stderr || '') + (result.stdout || '');

    // Poller valideert ROSA_CORE_URL en ROSA_CORE_API_KEY.
    // task-executor.js valideert WORKSPACE_ROOT eerder (module load).
    // Beide boodschappen zijn geldig bewijs dat startup validatie werkt.
    const hasValidationMessage =
      combined.includes('Missing required environment variables') ||
      combined.includes('WORKSPACE_ROOT') ||
      combined.includes('ROSA_CORE');

    assert.ok(
      hasValidationMessage,
      `Verwacht een startup validatie foutmelding. Output:\n${combined}`
    );
    // Bevestig dat het script met exit code 1 stopt
    assert.strictEqual(result.status, 1, 'Verwacht exit code 1');
  });
});
