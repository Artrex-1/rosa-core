'use strict';

const SCHEMA_SQL = `
  -- Existing conversations table (compatible with rosa-telegram)
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    session_id TEXT,
    source TEXT DEFAULT 'unknown',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user_id
  ON conversations(user_id, timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_conversations_session
  ON conversations(session_id, timestamp DESC);

  -- Tasks table for cross-instance delegation
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    priority INTEGER DEFAULT 0,
    created_by TEXT NOT NULL,
    assigned_to TEXT,
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON tasks(status, priority DESC, created_at ASC);

  CREATE INDEX IF NOT EXISTS idx_tasks_assigned
  ON tasks(assigned_to, status);

  -- Projects table for project knowledge
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT,
    description TEXT,
    metadata TEXT,
    last_analyzed DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Knowledge base for searchable content
  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('code', 'doc', 'conversation', 'note', 'analysis')),
    title TEXT,
    content TEXT NOT NULL,
    tags TEXT,
    source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_project
  ON knowledge(project_id, type);

  CREATE INDEX IF NOT EXISTS idx_knowledge_type
  ON knowledge(type, created_at DESC);

  -- FTS5 virtual table for full-text search on knowledge
  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title, content, tags,
    content=knowledge,
    content_rowid=id
  );

  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
    INSERT INTO knowledge_fts(rowid, title, content, tags)
    VALUES (new.id, new.title, new.content, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
    VALUES ('delete', old.id, old.title, old.content, old.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
    VALUES ('delete', old.id, old.title, old.content, old.tags);
    INSERT INTO knowledge_fts(rowid, title, content, tags)
    VALUES (new.id, new.title, new.content, new.tags);
  END;

  -- Sessions for context management
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    context TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id, active, last_active DESC);

  -- Geleerde lessen van Rosa
  CREATE TABLE IF NOT EXISTS lessons_learned (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    category TEXT NOT NULL,
    mistake TEXT NOT NULL,
    lesson TEXT NOT NULL,
    context TEXT,
    source TEXT DEFAULT 'manual',
    severity TEXT DEFAULT 'medium',
    occurrence_count INTEGER DEFAULT 1,
    last_seen_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_lessons_category
  ON lessons_learned(category, severity);

  CREATE INDEX IF NOT EXISTS idx_lessons_occurrence
  ON lessons_learned(occurrence_count DESC);

  -- User feedback op Rosa's responses
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    session_id TEXT,
    message_content TEXT,
    rating INTEGER,
    feedback_text TEXT,
    category TEXT,
    resolved_lesson_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_user
  ON feedback(user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_feedback_rating
  ON feedback(rating, created_at DESC);

  -- Patroon detectie log
  CREATE TABLE IF NOT EXISTS error_patterns (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    pattern_type TEXT NOT NULL,
    description TEXT NOT NULL,
    occurrence_count INTEGER DEFAULT 1,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    linked_lesson_id TEXT,
    metadata TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_patterns_type
  ON error_patterns(pattern_type, occurrence_count DESC);

  -- Project snapshots: actuele stand per project
  CREATE TABLE IF NOT EXISTS project_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL UNIQUE,
    features_done TEXT DEFAULT '[]',
    in_progress TEXT DEFAULT '[]',
    next_up TEXT DEFAULT '[]',
    key_decisions TEXT DEFAULT '[]',
    open_questions TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_project
  ON project_snapshots(project);

  -- Gestructureerd geheugen: beslissingen, ideeën, open vragen, etc.
  CREATE TABLE IF NOT EXISTS memory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    context TEXT,
    project TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_memory_items_project
  ON memory_items(project, updated_at DESC);
`;

module.exports = { SCHEMA_SQL };
