'use strict';

const { EventEmitter } = require('events');
const logger = require('../utils/logger');

/**
 * Singleton SSE manager for task events.
 * Keeps track of connected SSE clients and broadcasts events to all of them.
 */
class TaskEventEmitter extends EventEmitter {
  constructor() {
    super();
    // Map of clientId (string) → { res, timer }
    this._clients = new Map();
    this._nextClientId = 1;
  }

  /**
   * Register a new SSE client.
   * Sets the required SSE headers, sends an initial `connected` event,
   * and starts a per-client keepalive timer.
   *
   * @param {import('express').Response} res - Express response object
   * @returns {string} clientId assigned to this connection
   */
  subscribe(res) {
    const MAX_SSE_CLIENTS = parseInt(process.env.MAX_SSE_CLIENTS) || 10;
    if (this._clients.size >= MAX_SSE_CLIENTS) {
      logger.warn('SSE max clients reached, rejecting new connection', { max: MAX_SSE_CLIENTS });
      res.writeHead(503);
      res.end();
      return null;
    }

    const clientId = String(this._nextClientId++);

    // SSE headers must be set before the first write
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
    res.flushHeaders();

    // Send initial connected event
    const connectedPayload = JSON.stringify({ clientId, timestamp: new Date().toISOString() });
    res.write(`event: connected\ndata: ${connectedPayload}\n\n`);

    // Per-client heartbeat every 30 s to prevent proxy timeouts
    const timer = setInterval(() => {
      if (res.writableEnded) {
        this.unsubscribe(clientId);
        return;
      }
      res.write(':heartbeat\n\n');
    }, 30_000);

    this._clients.set(clientId, { res, timer });
    logger.info('SSE client connected', { clientId, total: this._clients.size });

    return clientId;
  }

  /**
   * Remove a client and clean up its heartbeat timer.
   * @param {string} clientId
   */
  unsubscribe(clientId) {
    const client = this._clients.get(clientId);
    if (!client) return;

    clearInterval(client.timer);
    this._clients.delete(clientId);
    logger.info('SSE client disconnected', { clientId, total: this._clients.size });
  }

  /**
   * Broadcast an SSE event to all connected clients.
   * Clients whose connection has ended are cleaned up automatically.
   *
   * @param {string} eventType  e.g. 'task.completed'
   * @param {object} data       JSON-serialisable payload
   */
  emit(eventType, data) {
    // Also call super.emit so internal EventEmitter listeners still work
    super.emit(eventType, data);

    if (this._clients.size === 0) return;

    const serialized = JSON.stringify(data);
    const message = `event: ${eventType}\ndata: ${serialized}\n\n`;

    for (const [clientId, client] of this._clients) {
      if (client.res.writableEnded) {
        this.unsubscribe(clientId);
        continue;
      }
      try {
        client.res.write(message);
      } catch (err) {
        logger.error('SSE write error', err, { clientId });
        this.unsubscribe(clientId);
      }
    }
  }

  /**
   * Send a raw heartbeat comment to all clients.
   * Called by the global interval in server.js.
   */
  heartbeat() {
    for (const [clientId, client] of this._clients) {
      if (client.res.writableEnded) {
        this.unsubscribe(clientId);
        continue;
      }
      try {
        client.res.write(':heartbeat\n\n');
      } catch (err) {
        logger.error('SSE heartbeat error', err, { clientId });
        this.unsubscribe(clientId);
      }
    }
  }

  /** Number of currently connected SSE clients. */
  get clientCount() {
    return this._clients.size;
  }
}

// Export a singleton instance so every module shares the same client list
module.exports = new TaskEventEmitter();
