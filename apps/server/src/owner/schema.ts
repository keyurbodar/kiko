import { migrate, type Step } from "@kiko/durable/migrate"
import { INITIAL_AGENT_STEPS } from "../agent/schema"
import { HISTORY_ARCHIVE_STEPS } from "./history-archive"
import { FILE_STEPS } from "../files/blob-store"
import { fileIndexSteps, ROOM_TABLES } from "../files/file-index"

const INITIAL_ROOM_STEPS: readonly Step[] = [
  `CREATE TABLE ws_tasks (room_id TEXT NOT NULL, id TEXT, title TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'blocked', 'review', 'done', 'cancelled')), owner TEXT, note TEXT, created_by TEXT NOT NULL, created_seq INTEGER NOT NULL, updated_at INTEGER NOT NULL, unblocked_seq INTEGER, woken_at INTEGER, chain TEXT, tainted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (room_id, id)) WITHOUT ROWID`,
  `CREATE TABLE ws_task_deps (room_id TEXT NOT NULL, task_id TEXT NOT NULL, depends_on TEXT NOT NULL, PRIMARY KEY (room_id, task_id, depends_on))`,
  `CREATE INDEX ws_task_deps_on ON ws_task_deps (room_id, depends_on)`,
  `CREATE TABLE pending_uploads (room_id TEXT NOT NULL, id TEXT, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, r2_key TEXT NOT NULL, sha256 TEXT, upload_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (room_id, id)) WITHOUT ROWID`,
  `CREATE INDEX pending_uploads_created ON pending_uploads (room_id, created_at)`,
  `CREATE TABLE root_counts (room_id TEXT NOT NULL, root_id TEXT, deliveries INTEGER NOT NULL, tripped INTEGER NOT NULL DEFAULT 0, at INTEGER, PRIMARY KEY (room_id, root_id)) WITHOUT ROWID`,
  `CREATE TABLE agent_sends (room_id TEXT NOT NULL, id TEXT, send TEXT NOT NULL, at INTEGER, PRIMARY KEY (room_id, id)) WITHOUT ROWID`,
  `CREATE TABLE mail_refused (room_id TEXT NOT NULL, id TEXT, at INTEGER NOT NULL, PRIMARY KEY (room_id, id)) WITHOUT ROWID`,
  `CREATE TABLE ended_runs (room_id TEXT NOT NULL, run_id TEXT, at INTEGER NOT NULL, PRIMARY KEY (room_id, run_id)) WITHOUT ROWID`,
  `CREATE TABLE routine_inflight (room_id TEXT NOT NULL, routine_id TEXT NOT NULL, occurrence TEXT NOT NULL, slug TEXT NOT NULL, seq INTEGER NOT NULL, started INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (room_id, routine_id, occurrence)) WITHOUT ROWID`,
  `CREATE TABLE members (room_id TEXT NOT NULL, slug TEXT, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', lead INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'idle', added_seq INTEGER NOT NULL, removed_at INTEGER, PRIMARY KEY (room_id, slug)) WITHOUT ROWID`,
  `CREATE TABLE agent_asks (room_id TEXT NOT NULL, id TEXT, asker TEXT NOT NULL, askee TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed')), answer TEXT, message_id TEXT, answer_send TEXT, remote TEXT, PRIMARY KEY (room_id, id)) WITHOUT ROWID`,
  `CREATE TABLE mem_turns (room_id TEXT NOT NULL, pos INTEGER, key TEXT NOT NULL, first_seq INTEGER, last_seq INTEGER, at INTEGER NOT NULL, at_last INTEGER NOT NULL, trace TEXT, PRIMARY KEY (room_id, pos)) WITHOUT ROWID`,
  `CREATE INDEX mem_turns_seq ON mem_turns (room_id, first_seq)`,
  `CREATE TABLE mem_did (room_id TEXT NOT NULL, slug TEXT NOT NULL, doing TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (room_id, slug, doing)) WITHOUT ROWID`,
  `CREATE TABLE memory_tree (room_id TEXT NOT NULL, size INTEGER NOT NULL, k INTEGER NOT NULL, text TEXT NOT NULL, at_from INTEGER NOT NULL, at_to INTEGER NOT NULL, PRIMARY KEY (room_id, size, k)) WITHOUT ROWID`,
  `CREATE TABLE memory_tree_fails (room_id TEXT NOT NULL, size INTEGER NOT NULL, k INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (room_id, size, k)) WITHOUT ROWID`,
  `CREATE TABLE team_leases (room_id TEXT NOT NULL, path TEXT, slug TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (room_id, path)) WITHOUT ROWID`,
  `CREATE INDEX mem_turns_key ON mem_turns (room_id, key)`,
  `CREATE TABLE human_asks (room_id TEXT NOT NULL, id TEXT, asker TEXT NOT NULL, question TEXT NOT NULL, options TEXT, message_id TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'skipped')), answer TEXT, questions TEXT, PRIMARY KEY (room_id, id)) WITHOUT ROWID`,
  `CREATE TABLE ws_task_reports (room_id TEXT NOT NULL, seq INTEGER, recipient TEXT NOT NULL, body TEXT NOT NULL, chain TEXT, PRIMARY KEY (room_id, seq)) WITHOUT ROWID`,
  `CREATE TABLE "pending" (room_id TEXT NOT NULL, id TEXT, seq INTEGER NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, reply_to TEXT, mentions TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (room_id, id)) WITHOUT ROWID`,
  `CREATE INDEX pending_seq ON pending (room_id, seq)`,
]

const INITIAL_USER_STEPS: readonly Step[] = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    prompt TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE user_events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE capture_queue (
    room_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    queued_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, message_id)
  ) WITHOUT ROWID`,
  `CREATE TABLE souls (slug TEXT PRIMARY KEY, body TEXT NOT NULL, sha TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE reminders (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    due_utc INTEGER NOT NULL,
    tz TEXT NOT NULL,
    rrule TEXT,
    room_id TEXT NOT NULL,
    target TEXT NOT NULL,
    created_by TEXT NOT NULL,
    status TEXT NOT NULL,
    last_fired INTEGER,
    created_at INTEGER NOT NULL,
    name TEXT,
    "trigger" TEXT,
    fails INTEGER NOT NULL DEFAULT 0,
    watch_state TEXT,
    hook_hash TEXT,
    chain TEXT
  ) WITHOUT ROWID`,
  `CREATE INDEX reminders_due ON reminders (status, due_utc)`,
  `CREATE TABLE routine_runs (
    routine_id TEXT NOT NULL,
    occurrence TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,
    seq INTEGER,
    PRIMARY KEY (routine_id, occurrence)
  )`,
  `CREATE TABLE credentials (
    provider_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    last4 TEXT NOT NULL,
    kek_version INTEGER NOT NULL,
    iv BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  , problem TEXT, problem_at INTEGER)`,
  `CREATE TABLE deletion_rooms (room_id TEXT PRIMARY KEY)`,
  `CREATE TABLE initiative_wakes (id TEXT PRIMARY KEY, room TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL, ids TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL)`,
  `CREATE TABLE composio (
    name TEXT PRIMARY KEY,
    kek_version INTEGER,
    iv BLOB,
    ciphertext BLOB,
    value TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE kernel (
    name TEXT PRIMARY KEY,
    kek_version INTEGER,
    iv BLOB,
    ciphertext BLOB,
    value TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE kernel_lease (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    session_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    kek_version INTEGER NOT NULL,
    iv BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    last_use INTEGER NOT NULL,
    tabs TEXT NOT NULL DEFAULT '{}',
    takeover INTEGER NOT NULL DEFAULT 0,
    watch_until INTEGER NOT NULL DEFAULT 0,
    dead INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE life (
    pos INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    norm TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    redacted INTEGER NOT NULL DEFAULT 0,
    ref TEXT NOT NULL DEFAULT '',
    superseded_by INTEGER,
    card TEXT
  )`,
  `CREATE INDEX life_norm ON life (norm)`,
  `CREATE INDEX life_ref ON life (ref)`,
  `CREATE VIRTUAL TABLE life_fts USING fts5(text)`,
  `CREATE INDEX life_pinned ON life (pos) WHERE pinned = 1`,
  `CREATE INDEX life_card ON life (pos) WHERE card IS NOT NULL AND pinned = 0`,
  `CREATE INDEX reminders_fired ON reminders (status, last_fired)`,
  `CREATE VIRTUAL TABLE life_tri USING fts5(text, tokenize = 'trigram')`,
  `CREATE INDEX reminders_hook ON reminders (hook_hash)`,
  `CREATE TABLE recipe_installs (
    install_id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    room_id TEXT NOT NULL,
    agent TEXT NOT NULL,
    at INTEGER NOT NULL
  ) WITHOUT ROWID`,
  `CREATE UNIQUE INDEX recipe_installs_target ON recipe_installs (slug, room_id, agent)`,
  `CREATE TABLE recipe_links (routine_id TEXT PRIMARY KEY, install_id TEXT NOT NULL)`,
  `CREATE INDEX recipe_links_install ON recipe_links (install_id)`,
  `CREATE TABLE model_catalog (provider_id TEXT PRIMARY KEY, models TEXT NOT NULL)`,
  `CREATE TABLE deletion_agents (slug TEXT PRIMARY KEY)`,
  `CREATE TABLE deleted_agent_handles (slug TEXT PRIMARY KEY)`,
  `CREATE TABLE room_directory (room_id TEXT PRIMARY KEY)`,
]

const OWNER_STEPS: readonly Step[] = [
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
  `CREATE UNIQUE INDEX IF NOT EXISTS messages_id ON messages (room_id, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS messages_run ON messages (room_id, run_id, run_attempt, run_index) WHERE run_id IS NOT NULL`,
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
  `CREATE INDEX IF NOT EXISTS run_steps_slug_seq ON run_steps (room_id, slug, after_seq)`,
  ...INITIAL_AGENT_STEPS,
  ...HISTORY_ARCHIVE_STEPS,
  ...FILE_STEPS,
  ...fileIndexSteps(ROOM_TABLES),
  ...INITIAL_ROOM_STEPS,
  ...INITIAL_USER_STEPS,
  `CREATE TABLE owner_meta (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, key)) WITHOUT ROWID, STRICT`,
  `CREATE INDEX messages_at ON messages (room_id, at)`,
  `CREATE TABLE owner_runs (agent TEXT PRIMARY KEY, room_id TEXT NOT NULL, slug TEXT NOT NULL, request_id TEXT NOT NULL, ready_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1) WITHOUT ROWID, STRICT`,
  `CREATE INDEX owner_runs_ready ON owner_runs (ready_at, agent)`,
  `CREATE TABLE archived_unread (room_id TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (room_id, seq)) WITHOUT ROWID, STRICT`,
  `CREATE TABLE IF NOT EXISTS owner_deadlines (scope TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID, STRICT`,
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
  `DROP INDEX IF EXISTS messages_at`,
  `DROP INDEX IF EXISTS owner_runs_ready`,
  `DROP TABLE IF EXISTS outbox`,
  `DROP INDEX IF EXISTS mem_turns_seq`,
  `DROP INDEX IF EXISTS mem_turns_key`,
  `DROP TRIGGER IF EXISTS messages_search_insert`,
  `DROP TRIGGER IF EXISTS messages_search_update`,
  `DROP TRIGGER IF EXISTS messages_search_delete`,
  `ALTER TABLE messages ADD COLUMN client_id TEXT`,
  `ALTER TABLE messages ADD COLUMN message_payload TEXT`,
  `ALTER TABLE messages ADD COLUMN mentions TEXT`,
  `UPDATE messages SET message_payload = (SELECT payload FROM events WHERE events.room_id = messages.room_id AND events.seq = messages.seq AND kind = 'message'), client_id = (SELECT client_id FROM clients WHERE clients.room_id = messages.room_id AND clients.message_id = messages.id)`,
  `DELETE FROM events WHERE kind = 'message'`,
  `DROP TABLE clients`,
  `DROP INDEX IF EXISTS messages_id`,
  `DROP INDEX IF EXISTS messages_run`,
  `DROP TABLE messages_fts`,
  `CREATE VIRTUAL TABLE messages_fts USING fts5(room, chunk, room_id UNINDEXED, first_seq UNINDEXED, last_seq UNINDEXED, edit_seq UNINDEXED, members UNINDEXED)`,
  `DROP INDEX IF EXISTS pending_seq`,
  `DROP TABLE IF EXISTS pending`,
  `CREATE TRIGGER search_hydrated_insert AFTER INSERT ON messages
   WHEN new.seq <= (SELECT json_extract(value, '$.last_seq') FROM owner_meta WHERE scope = 'room:' || new.room_id AND key = 'search-state')
   BEGIN INSERT OR IGNORE INTO owner_meta (scope, key, value) VALUES ('room:' || new.room_id, 'search-hydrated:' || new.seq, CAST(new.seq AS TEXT)); END`,
  `ALTER TABLE members ADD COLUMN lead_seq INTEGER NOT NULL DEFAULT 0`,
  `UPDATE members SET lead_seq = COALESCE((SELECT MIN(events.seq) FROM events WHERE events.room_id = members.room_id AND events.seq >= members.added_seq AND kind = 'member' AND json_extract(payload, '$.member.slug') = members.slug AND json_extract(payload, '$.member.lead') = 1 AND events.seq > COALESCE((SELECT MAX(previous.seq) FROM events AS previous WHERE previous.room_id = members.room_id AND previous.seq >= members.added_seq AND previous.kind = 'member' AND json_extract(previous.payload, '$.member.slug') = members.slug AND json_extract(previous.payload, '$.member.lead') = 0), 0)), added_seq)`,
]

export function initializeSchema(storage: DurableObjectStorage): void {
  migrate(storage, OWNER_STEPS)
}

export function eraseRoomSchema(storage: DurableObjectStorage, roomId: string): void {
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM events WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM messages WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM reactions WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM run_steps WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM files WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM directories WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM owner_runs WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM archived_unread WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM history_archive_state WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM history_archive_pending WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM ws_tasks WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM ws_task_deps WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM pending_uploads WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM root_counts WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM agent_sends WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM mail_refused WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM routine_inflight WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM members WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM agent_asks WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM mem_turns WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM mem_did WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM memory_tree WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM memory_tree_fails WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM team_leases WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM human_asks WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM ws_task_reports WHERE room_id = ?", roomId)
    storage.sql.exec("DELETE FROM owner_meta WHERE scope = ?", `room:${roomId}`)
    storage.sql.exec("INSERT INTO owner_meta (scope, key, value) VALUES (?, 'deleted', '1')", `room:${roomId}`)
    storage.sql.exec("DELETE FROM owner_deadlines WHERE scope = ?", `room:${roomId}`)
  })
}
