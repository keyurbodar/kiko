const TABLES = [
  `CREATE TABLE IF NOT EXISTS chats (
    room_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    last_seq INTEGER NOT NULL DEFAULT 0,
    last_preview TEXT NOT NULL DEFAULT '',
    unread INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    agents TEXT NOT NULL DEFAULT '[]'
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
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS limits (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL
  )`,
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
]

export function migrate(sql: SqlStorage): void {
  for (const statement of TABLES) sql.exec(statement)
  // Executor was removed. Its sealed tokens must not outlive it.
  sql.exec("DROP TABLE IF EXISTS executor_secrets")
  const columns = sql.exec<{ name: string }>("PRAGMA table_info(chats)").toArray()
  if (!columns.some((c) => c.name === "agents")) sql.exec("ALTER TABLE chats ADD COLUMN agents TEXT NOT NULL DEFAULT '[]'")
  if (!columns.some((c) => c.name === "private")) sql.exec("ALTER TABLE chats ADD COLUMN private INTEGER NOT NULL DEFAULT 0")
  if (!columns.some((c) => c.name === "draft")) sql.exec("ALTER TABLE chats ADD COLUMN draft TEXT")
  if (!columns.some((c) => c.name === "last")) sql.exec("ALTER TABLE chats ADD COLUMN last TEXT")
  if (!columns.some((c) => c.name === "mentions")) sql.exec("ALTER TABLE chats ADD COLUMN mentions INTEGER NOT NULL DEFAULT 0")
  if (!columns.some((c) => c.name === "grp")) sql.exec("ALTER TABLE chats ADD COLUMN grp INTEGER NOT NULL DEFAULT 0")
}
