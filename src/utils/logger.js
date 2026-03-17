'use strict';

const MODULE = process.env.ROSA_LOG_MODULE || 'rosa-core';

function formatLog(level, msg, data = {}) {
  return JSON.stringify({
    level,
    module: MODULE,
    msg,
    ...data,
    ts: new Date().toISOString(),
  });
}

const logger = {
  info: (msg, data = {}) => console.log(formatLog('info', msg, data)),
  warn: (msg, data = {}) => console.warn(formatLog('warn', msg, data)),
  error: (msg, err, data = {}) => {
    const errorData = err instanceof Error
      ? { error: err.message, stack: err.stack, ...data }
      : { error: err, ...data };
    console.error(formatLog('error', msg, errorData));
  },
};

module.exports = logger;
