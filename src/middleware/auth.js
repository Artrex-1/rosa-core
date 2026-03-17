'use strict';

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const validKeys = (process.env.API_KEYS || '').split(',').filter(Boolean);

  if (validKeys.length === 0) {
    // No API keys configured — only allow if ROSA_DEV_MODE is explicitly enabled
    if (process.env.ROSA_DEV_MODE === 'true') {
      req.clientId = 'dev';
      return next();
    }
    return res.status(401).json({
      error: 'No API keys configured and ROSA_DEV_MODE is not enabled. ' +
             'Set API_KEYS in .env or set ROSA_DEV_MODE=true for local development.',
    });
  }

  if (!apiKey || !validKeys.includes(apiKey)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  // Identify which Rosa instance is calling
  const keyIndex = validKeys.indexOf(apiKey);
  const clientNames = (process.env.API_KEY_NAMES || 'chat-rosa,laptop-rosa').split(',');
  req.clientId = clientNames[keyIndex] || `client-${keyIndex}`;

  next();
}

module.exports = { apiKeyAuth };
