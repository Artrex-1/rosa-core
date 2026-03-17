'use strict';

const path = require('path');
const fs = require('fs');
const { SCHEMA_SQL } = require('./schema');
const logger = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'rosa-core.db');

let db = null;

function getDatabase() {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const Database = require('better-sqlite3');

  // Remove stale WAL/SHM files left by a previous crash (e.g. Docker restart).
  // Opening the DB with DELETE journal first forces SQLite to recover without needing the old shm.
  const shmPath = DB_PATH + '-shm';
  const walPath = DB_PATH + '-wal';
  if (fs.existsSync(shmPath) || fs.existsSync(walPath)) {
    try {
      const recovery = new Database(DB_PATH);
      recovery.pragma('journal_mode = DELETE');
      recovery.pragma('wal_checkpoint(TRUNCATE)');
      recovery.close();
      // Now safe to remove stale files
      try { fs.unlinkSync(shmPath); } catch {}
      try { fs.unlinkSync(walPath); } catch {}
      logger.info('Recovered stale WAL/SHM files');
    } catch (err) {
      logger.warn('WAL recovery failed, trying direct open', { code: err.code, error: err.message });
    }
  }

  db = new Database(DB_PATH);
  // WAL mode werkt niet op Windows-gemounte Docker volumes (SQLITE_IOERR_SHMOPEN)
  // Gebruik DELETE mode als fallback
  try {
    db.pragma('journal_mode = WAL');
  } catch (e) {
    logger.warn('WAL mode niet beschikbaar, gebruik DELETE mode', { error: e.message });
    db.pragma('journal_mode = DELETE');
  }
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  logger.info('Database initialized', { path: DB_PATH });
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}

module.exports = { getDatabase, closeDatabase, DB_PATH };
