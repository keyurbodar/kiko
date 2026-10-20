import { migrate, type Step } from "@kiko/durable/migrate"
import { ROOM_STEPS } from "../room/schema"
import { JOURNAL_STEPS } from "@kiko/agent/journal"

export const OWNER_STEPS: readonly Step[] = [
  `CREATE TABLE IF NOT EXISTS events (
    room_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (room_id, seq)
  ) WITHOUT ROWID, STRICT`,
  `CREATE TABLE IF NOT EXISTS messages (
    room_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    id TEXT NOT NULL,
    at INTEGER NOT NULL,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    rich TEXT,
    reply_to TEXT,
    files TEXT,
    run_id TEXT,
    run_attempt INTEGER,
    run_index INTEGER,
    edited_at INTEGER,
    deleted_at INTEGER,
    goto TEXT,
    quote TEXT,
    tainted INTEGER NOT NULL DEFAULT 0,
    addressed TEXT,
    initiative TEXT,
    event TEXT,
    steps INTEGER,
    step_after INTEGER,
    PRIMARY KEY (room_id, seq)
  ) WITHOUT ROWID, STRICT`,
  "CREATE UNIQUE INDEX IF NOT EXISTS messages_id ON messages (room_id, id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS messages_run ON messages (room_id, run_id, run_attempt, run_index) WHERE run_id IS NOT NULL",
  `CREATE TABLE IF NOT EXISTS reactions (
    room_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    emoji TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (room_id, message_id, actor)
  ) WITHOUT ROWID, STRICT`,
  `CREATE TABLE IF NOT EXISTS clients (
    room_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (room_id, client_id)
  ) WITHOUT ROWID, STRICT`,
  `CREATE TABLE IF NOT EXISTS run_steps (
    room_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    id TEXT NOT NULL,
    slug TEXT NOT NULL,
    tool TEXT NOT NULL,
    name TEXT NOT NULL,
    app TEXT,
    worker TEXT,
    note INTEGER,
    label TEXT NOT NULL,
    input TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    output TEXT,
    after_seq INTEGER NOT NULL,
    PRIMARY KEY (room_id, run_id, id)
  ) WITHOUT ROWID, STRICT`,
  "CREATE INDEX IF NOT EXISTS run_steps_slug_seq ON run_steps (room_id, slug, after_seq)",
  ...JOURNAL_STEPS,
  "CREATE TABLE IF NOT EXISTS owner_deadlines (scope TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID, STRICT",
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(room, message, text, room_id UNINDEXED, seq UNINDEXED)`,
  `CREATE TRIGGER IF NOT EXISTS messages_search_insert AFTER INSERT ON messages WHEN new.deleted_at IS NULL BEGIN
    INSERT INTO messages_fts (room, message, text, room_id, seq)
    VALUES ('r' || hex(new.room_id), 'm' || hex(new.room_id) || 'x' || new.seq, new.text, new.room_id, new.seq);
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_search_update AFTER UPDATE OF text, deleted_at ON messages
  WHEN new.text IS NOT old.text OR new.deleted_at IS NOT old.deleted_at BEGIN
    DELETE FROM messages_fts WHERE rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ('message:m' || hex(old.room_id) || 'x' || old.seq));
    INSERT INTO messages_fts (room, message, text, room_id, seq)
    SELECT 'r' || hex(new.room_id), 'm' || hex(new.room_id) || 'x' || new.seq, new.text, new.room_id, new.seq WHERE new.deleted_at IS NULL;
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_search_delete AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ('message:m' || hex(old.room_id) || 'x' || old.seq));
  END`,
]

export function initializeSchema(storage: DurableObjectStorage): void {
  migrate(storage, OWNER_STEPS)
}

const ROOM_TABLES = ["events", "messages", "reactions", "clients", "run_steps"] as const

export function initializeRoomSchema(
  storage: DurableObjectStorage,
  scoped: DurableObjectStorage,
  roomId: string,
  prefix: string,
): void {
  migrate(scoped, ROOM_STEPS)
  storage.transactionSync(() => {
    for (const table of ROOM_TABLES) {
      const name = `${prefix}${table}`
      const existing = storage.sql.exec<{ type: string }>("SELECT type FROM sqlite_master WHERE name = ?", name).toArray()[0]
      if (existing?.type === "view") continue
      const shared = new Set(storage.sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray().map((row) => row.name))
      const columns = storage.sql.exec<{ name: string }>(`PRAGMA table_info("${name}")`).toArray().map((row) => row.name).filter((column) => column !== "room_id" && shared.has(column))
      const list = columns.map((column) => `"${column}"`).join(", ")
      storage.sql.exec(`INSERT INTO ${table} (room_id, ${list}) SELECT ?, ${list} FROM "${name}"`, roomId)
      storage.sql.exec(`DROP TABLE "${name}"`)
      const literal = `'${roomId.replaceAll("'", "''")}'`
      storage.sql.exec(`CREATE VIEW "${name}" AS SELECT ${list} FROM ${table} WHERE room_id = ${literal}`)
    }
    storage.sql.exec(`DROP TABLE IF EXISTS "${prefix}messages_fts"`)
  })
}

export function eraseRoomSchema(storage: DurableObjectStorage, roomId: string): void {
  storage.transactionSync(() => {
    for (const table of ROOM_TABLES) storage.sql.exec(`DELETE FROM ${table} WHERE room_id = ?`, roomId)
  })
}
