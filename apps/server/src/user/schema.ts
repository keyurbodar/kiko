import { getSetting, setSetting } from "../lib/settings"

// One entry per schema version, applied once, in order. Version 1 is the current shape of every table.
// A later change appends an entry. An entry that has run is never edited.
const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE IF NOT EXISTS chats (
    room_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    last_seq INTEGER NOT NULL DEFAULT 0,
    last_preview TEXT NOT NULL DEFAULT '',
    unread INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    agents TEXT NOT NULL DEFAULT '[]',
    private INTEGER NOT NULL DEFAULT 0,
    draft TEXT,
    last TEXT,
    mentions INTEGER NOT NULL DEFAULT 0,
    grp INTEGER NOT NULL DEFAULT 0
  )`,
    `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    prompt TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS rooms (room_id TEXT PRIMARY KEY)`,
    `CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS user_events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS autonomous_taken (id TEXT PRIMARY KEY, day TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS capture_queue (
    room_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    queued_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, message_id)
  )`,
    `CREATE TABLE IF NOT EXISTS loop_heard (
    room_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    agent TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (room_id, message_id)
  )`,
    `CREATE TABLE IF NOT EXISTS nap_applied (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  ],
]

export function migrate(sql: SqlStorage): void {
  // The version lives here, so the table exists before the first read of it.
  sql.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  const from = Number(getSetting(sql, "schema_version") ?? 0)
  for (const migration of MIGRATIONS.slice(from)) for (const statement of migration) sql.exec(statement)
  if (from < MIGRATIONS.length) setSetting(sql, "schema_version", String(MIGRATIONS.length))
}
