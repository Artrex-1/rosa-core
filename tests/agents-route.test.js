'use strict';

/**
 * Tests voor GET /agents en GET /agents/:id (Fix 2 — agents endpoint)
 *
 * Strategie: standalone Express-app met alleen de agents router,
 * zodat geen database, auth of port-conflict van server.js nodig is.
 */

const express = require('express');
const http = require('http');

let app;
let server;
let baseUrl;

beforeAll((done) => {
  app = express();
  app.use(express.json());
  const agentRoutes = require('../src/routes/agents');
  app.use('/agents', agentRoutes);

  server = http.createServer(app);
  server.listen(0, () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
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

// ─── AGENTS LIJST ────────────────────────────────────────────────────────────

describe('GET /agents', () => {
  test('retourneert 200 en een agents array', async () => {
    const { status, body } = await get('/agents');
    expect(status).toBe(200);
    expect(body).toHaveProperty('agents');
    expect(Array.isArray(body.agents)).toBe(true);
  });

  test('bevat precies 8 agents', async () => {
    const { body } = await get('/agents');
    expect(body.agents.length).toBe(8);
  });

  const EXPECTED_IDS = ['nora', 'luna', 'mila', 'sara', 'vera', 'yara', 'tara', 'laptop-rosa'];

  for (const agentId of EXPECTED_IDS) {
    test(`agent "${agentId}" aanwezig in lijst`, async () => {
      const { body } = await get('/agents');
      const found = body.agents.find(a => a.id === agentId);
      expect(found).toBeDefined();
    });
  }

  test('elke agent heeft verplichte velden: id, name, role, description, specialties', async () => {
    const { body } = await get('/agents');
    for (const agent of body.agents) {
      expect(agent).toHaveProperty('id');
      expect(typeof agent.id).toBe('string');
      expect(agent.id.length).toBeGreaterThan(0);

      expect(agent).toHaveProperty('name');
      expect(typeof agent.name).toBe('string');
      expect(agent.name.length).toBeGreaterThan(0);

      expect(agent).toHaveProperty('role');
      expect(typeof agent.role).toBe('string');
      expect(agent.role.length).toBeGreaterThan(0);

      expect(agent).toHaveProperty('description');
      expect(typeof agent.description).toBe('string');
      expect(agent.description.length).toBeGreaterThan(0);

      expect(agent).toHaveProperty('specialties');
      expect(Array.isArray(agent.specialties)).toBe(true);
      expect(agent.specialties.length).toBeGreaterThan(0);
    }
  });

  test('Yara heeft de juiste role en specialties', async () => {
    const { body } = await get('/agents');
    const yara = body.agents.find(a => a.id === 'yara');
    expect(yara).toBeDefined();
    expect(yara.role).toBe('Research & Discovery Specialist');
    expect(yara.specialties).toContain('research');
  });

  test('Tara heeft de juiste role en specialties', async () => {
    const { body } = await get('/agents');
    const tara = body.agents.find(a => a.id === 'tara');
    expect(tara).toBeDefined();
    expect(tara.role).toBe('Documentatie Specialist');
    expect(tara.specialties).toContain('documentation');
  });
});

// ─── AGENT BY ID ─────────────────────────────────────────────────────────────

describe('GET /agents/:id', () => {
  test('retourneert 200 voor een bestaande agent', async () => {
    const { status, body } = await get('/agents/nora');
    expect(status).toBe(200);
    expect(body.id).toBe('nora');
    expect(body.name).toBe('Nora');
  });

  test('retourneert 200 voor yara', async () => {
    const { status, body } = await get('/agents/yara');
    expect(status).toBe(200);
    expect(body.id).toBe('yara');
  });

  test('retourneert 200 voor tara', async () => {
    const { status, body } = await get('/agents/tara');
    expect(status).toBe(200);
    expect(body.id).toBe('tara');
  });

  test('retourneert 200 voor laptop-rosa', async () => {
    const { status, body } = await get('/agents/laptop-rosa');
    expect(status).toBe(200);
    expect(body.id).toBe('laptop-rosa');
  });

  test('retourneert 404 voor onbekende agent', async () => {
    const { status, body } = await get('/agents/onbekend-agent-xyz');
    expect(status).toBe(404);
    expect(body).toHaveProperty('error', true);
    expect(body).toHaveProperty('message');
    expect(body.message).toContain('onbekend-agent-xyz');
  });

  test('response van :id bevat dezelfde data als in de lijst', async () => {
    const list = await get('/agents');
    const byId = await get('/agents/vera');

    const fromList = list.body.agents.find(a => a.id === 'vera');
    expect(byId.body).toEqual(fromList);
  });
});

// ─── CONTRACT: response-structuur ────────────────────────────────────────────

describe('CONTRACT: response-structuur van GET /agents', () => {
  test('root heeft alleen "agents" sleutel', async () => {
    const { body } = await get('/agents');
    expect(Object.keys(body)).toEqual(['agents']);
  });

  test('agent-id values zijn lowercase zonder spaties', async () => {
    const { body } = await get('/agents');
    for (const agent of body.agents) {
      expect(agent.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  test('geen dubbele ids in de lijst', async () => {
    const { body } = await get('/agents');
    const ids = body.agents.map(a => a.id);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(ids.length);
  });
});
