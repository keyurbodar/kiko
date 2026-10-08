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
    updated_at INTEGER NOT NULL,
    agents TEXT NOT NULL DEFAULT '[]'
  )`,
  // The user's agents. A user-level record; a room's membership is its own table.
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    prompt TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  // Every room the Worker has addressed for this user, chat or not, and never pruned.
  // Account deletion reads it, so a room opened but never listed is still deleted.
  `CREATE TABLE IF NOT EXISTS rooms (room_id TEXT PRIMARY KEY)`,
  // Small user preferences, one JSON value per key.
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Section 25.7: each room's open tasks, as the room last reported them.
  `CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)`,
  // Usage counters, one row per key and window.
  `CREATE TABLE IF NOT EXISTS limits (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL
  )`,
  // The user socket's durable events. `seq` only increases. Architecture section 9.2.
  `CREATE TABLE IF NOT EXISTS user_events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)`,
]

export function migrate(sql: SqlStorage): void {
  for (const statement of TABLES) sql.exec(statement)
  // A chats table made before agents existed has no column for them.
  const columns = sql.exec<{ name: string }>("PRAGMA table_info(chats)").toArray()
  if (!columns.some((c) => c.name === "agents")) sql.exec("ALTER TABLE chats ADD COLUMN agents TEXT NOT NULL DEFAULT '[]'")
  if (!columns.some((c) => c.name === "private")) sql.exec("ALTER TABLE chats ADD COLUMN private INTEGER NOT NULL DEFAULT 0")
  if (!columns.some((c) => c.name === "draft")) sql.exec("ALTER TABLE chats ADD COLUMN draft TEXT")
  // The row's activity line as `ChatLast` JSON, the unread mentions of the human, and whether it is a group.
  if (!columns.some((c) => c.name === "last")) sql.exec("ALTER TABLE chats ADD COLUMN last TEXT")
  if (!columns.some((c) => c.name === "mentions")) sql.exec("ALTER TABLE chats ADD COLUMN mentions INTEGER NOT NULL DEFAULT 0")
  if (!columns.some((c) => c.name === "grp")) sql.exec("ALTER TABLE chats ADD COLUMN grp INTEGER NOT NULL DEFAULT 0")
}
