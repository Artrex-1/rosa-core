'use strict';

/**
 * Send a consistent JSON error response.
 *
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {object} [details] - Optional extra details
 * @param {import('express').Request} [req] - Optional request (for requestId)
 */
function sendError(res, statusCode, message, details, req) {
  const body = { error: true, message };
  if (details) body.details = details;
  if (req && req.id) body.requestId = req.id;
  res.status(statusCode).json(body);
}

module.exports = { sendError };
