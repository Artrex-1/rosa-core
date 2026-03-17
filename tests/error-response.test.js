'use strict';

/**
 * Unit tests voor rosa-core/src/utils/error-response.js
 * Test: status codes, response body format, details veld, requestId veld
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { sendError } = require('../src/utils/error-response');

// Minimale mock voor Express Response
function mockRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  return res;
}

describe('sendError helper', () => {
  it('zet de juiste HTTP status code', () => {
    const res = mockRes();
    sendError(res, 400, 'Bad request');
    assert.strictEqual(res._status, 400);
  });

  it('response body bevat error:true en message', () => {
    const res = mockRes();
    sendError(res, 400, 'Verplicht veld ontbreekt');
    assert.strictEqual(res._body.error, true);
    assert.strictEqual(res._body.message, 'Verplicht veld ontbreekt');
  });

  it('details veld is aanwezig wanneer meegegeven', () => {
    const res = mockRes();
    sendError(res, 422, 'Validatiefout', { field: 'email', reason: 'invalid format' });
    assert.deepStrictEqual(res._body.details, { field: 'email', reason: 'invalid format' });
  });

  it('details veld ontbreekt wanneer niet meegegeven', () => {
    const res = mockRes();
    sendError(res, 400, 'Fout');
    assert.strictEqual(res._body.details, undefined);
  });

  it('requestId wordt opgenomen uit req.id wanneer aanwezig', () => {
    const res = mockRes();
    const req = { id: 'test-uuid-1234' };
    sendError(res, 401, 'Unauthorized', null, req);
    assert.strictEqual(res._body.requestId, 'test-uuid-1234');
  });

  it('requestId ontbreekt wanneer req niet meegegeven', () => {
    const res = mockRes();
    sendError(res, 500, 'Server error');
    assert.strictEqual(res._body.requestId, undefined);
  });

  it('requestId ontbreekt wanneer req.id niet gezet is', () => {
    const res = mockRes();
    const req = {}; // geen .id veld
    sendError(res, 403, 'Forbidden', null, req);
    assert.strictEqual(res._body.requestId, undefined);
  });

  it('werkt correct met 404 status', () => {
    const res = mockRes();
    sendError(res, 404, 'Not found');
    assert.strictEqual(res._status, 404);
    assert.strictEqual(res._body.message, 'Not found');
  });

  it('werkt correct met 500 status', () => {
    const res = mockRes();
    sendError(res, 500, 'Internal server error');
    assert.strictEqual(res._status, 500);
  });

  it('details is null behandeld als geen details (geen veld)', () => {
    const res = mockRes();
    sendError(res, 400, 'Fout', null);
    // null is falsy, dus details veld mag niet gezet worden
    assert.strictEqual(res._body.details, undefined);
  });
});
