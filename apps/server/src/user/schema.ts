// The tables a `UserDO` owns. Architecture section 4.1.
//
// Every statement is idempotent, so the object runs them on every start. A later
// task that needs a new column adds an `ALTER TABLE` guarded the same way.

const TABLES = [
  // The chat list. One row per room the user has.
  `CREATE TABLE IF NOT EXISTS chats (
    room_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    last_seq INTEGER NOT NULL DEFAULT 0,
    last_preview TEXT NOT NULL DEFAULT '',
    unread INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  // Small user preferences, one JSON value per key.
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Usage counters, one row per key and window.
  `CREATE TABLE IF NOT EXISTS limits (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL
  )`,
  // The user socket's durable events. `seq` only increases. Architecture section 9.2.
  `CREATE TABLE IF NOT EXISTS user_events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)`,
  // Memory. Architecture section 13.1. The FTS table is kept in step by memory.ts.
  `CREATE TABLE IF NOT EXISTS memory_records (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    body TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    uses INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS memory_versions (
    record_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (record_id, version)
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, title, aliases, body)`,
]

export function migrate(sql: SqlStorage): void {
  for (const statement of TABLES) sql.exec(statement)
}
