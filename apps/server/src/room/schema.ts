// The room's SQLite tables. Architecture section 9.2. Each entry in MIGRATIONS
// runs once, in order, and the applied count lives in `meta`. Append a new entry
// to change a table. `meta` holds small values by key. Never edit an entry that has shipped.

const MIGRATIONS: readonly string[] = [
	`
	-- Every stored change a human can see. seq only increases and is never reused.
	-- actor is "human", "agent:<slug>", or "system:<reason>". payload is the event
	-- without seq and at, as JSON.
	CREATE TABLE events (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		kind TEXT NOT NULL,
		at INTEGER NOT NULL,
		actor TEXT NOT NULL,
		payload TEXT NOT NULL
	);

	-- The current state of each message, with edits applied. sender, rich, and
	-- files are JSON. A deleted message keeps its row so ids are never reused.
	CREATE TABLE messages (
		id TEXT PRIMARY KEY,
		seq INTEGER NOT NULL UNIQUE,
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
		UNIQUE (run_id, run_attempt, run_index)
	);

	-- One reaction per actor per message.
	CREATE TABLE reactions (
		message_id TEXT NOT NULL,
		actor TEXT NOT NULL,
		emoji TEXT NOT NULL,
		at INTEGER NOT NULL,
		PRIMARY KEY (message_id, actor)
	);

	-- Send dedupe. A resent clientId gets the first ack and stores nothing.
	CREATE TABLE clients (
		client_id TEXT NOT NULL UNIQUE,
		message_id TEXT NOT NULL,
		seq INTEGER NOT NULL
	);
	`,
	// Message search. Architecture section 9.2. The index reads text from messages and
	// triggers keep it in step inside the same transaction as the write. A deleted message
	// leaves the index. An edit replaces its entry.
	`
	CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='rowid');
	CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages WHEN new.deleted_at IS NULL BEGIN
		INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
	END;
	CREATE TRIGGER messages_fts_update AFTER UPDATE OF text, deleted_at ON messages BEGIN
		INSERT INTO messages_fts (messages_fts, rowid, text) SELECT 'delete', old.rowid, old.text WHERE old.deleted_at IS NULL;
		INSERT INTO messages_fts (rowid, text) SELECT new.rowid, new.text WHERE new.deleted_at IS NULL;
	END;
	INSERT INTO messages_fts (messages_fts) VALUES ('rebuild');
	`,
	`
	-- The room's file index (files.ts). Bytes are in R2 under r2_key. A path holds
	-- one file. author is an actor key, as in events.
	CREATE TABLE ws_files (
		id TEXT PRIMARY KEY,
		path TEXT NOT NULL UNIQUE,
		r2_key TEXT NOT NULL,
		size INTEGER NOT NULL,
		type TEXT NOT NULL,
		sha256 TEXT NOT NULL,
		width INTEGER,
		height INTEGER,
		thumbhash TEXT,
		author TEXT NOT NULL,
		at INTEGER NOT NULL
	);
	`,
	`
	-- The workspace (workspace.ts, architecture sections 4.3 and 7.6). Actors are actor keys, as in
	-- events. unblocked_seq is the event that finished a task's last open dependency; woken_at is set
	-- once its owner admitted the task_unblocked envelope, so the wake happens once.
	CREATE TABLE ws_tasks (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'blocked', 'review', 'done', 'cancelled')),
		owner TEXT,
		note TEXT,
		created_by TEXT NOT NULL,
		created_seq INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		unblocked_seq INTEGER,
		woken_at INTEGER
	);
	CREATE TABLE ws_task_deps (
		task_id TEXT NOT NULL,
		depends_on TEXT NOT NULL,
		PRIMARY KEY (task_id, depends_on)
	);
	CREATE INDEX ws_task_deps_on ON ws_task_deps (depends_on);
	CREATE TABLE ws_activity (
		id TEXT PRIMARY KEY,
		at INTEGER NOT NULL,
		actor TEXT NOT NULL,
		task_id TEXT,
		text TEXT NOT NULL
	);
	CREATE INDEX ws_activity_at ON ws_activity (at);
	CREATE TABLE ws_notes (
		title TEXT PRIMARY KEY,
		body TEXT NOT NULL,
		author TEXT NOT NULL,
		at INTEGER NOT NULL
	);
	`,
	`
	-- A message can point at another chat, such as the one kiko just made (architecture section 7.11).
	ALTER TABLE messages ADD COLUMN goto TEXT;
	`,
	`
	-- The words of the replied-to message the human picked to answer (a quote).
	ALTER TABLE messages ADD COLUMN quote TEXT;
	`,
	`
	-- The card for the message's first link, as JSON (architecture section 18.2).
	ALTER TABLE messages ADD COLUMN preview TEXT;
	`,
	`
	-- The newest event of one kind (the chat row's newest reaction or approval card, the reactions
	-- since an agent's last brief) without reading the whole log.
	CREATE INDEX events_kind_seq ON events (kind, seq);
	-- The chat row's unread count and mention scan read agent messages after the read mark. These
	-- partial indexes hold only those rows, so a long chat of human messages costs them nothing.
	-- Each WHERE matches its query's term exactly (deliver.ts chatTouch), or SQLite skips the index.
	CREATE INDEX messages_not_human ON messages (seq) WHERE json_extract(sender, '$.kind') != 'human';
	CREATE INDEX messages_agent ON messages (seq) WHERE json_extract(sender, '$.kind') = 'agent';
	`,
	`
	-- A message written by a run that read outside content (section 16). Log memory marks what is built from it.
	ALTER TABLE messages ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0;
	`,
	`
	-- The activity log and shared notes were written by agents and read by nobody. A run's trace line in
	-- memory (section 13) says what an agent did, and /chat.md holds decisions.
	DROP TABLE IF EXISTS ws_activity;
	DROP TABLE IF EXISTS ws_notes;
	`,
]

/** Brings the tables up to date in one transaction. Safe to call on every start. */
export function migrate(storage: DurableObjectStorage): void {
	const sql = storage.sql
	storage.transactionSync(() => {
		sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
		const row = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'").toArray()[0]
		const from = row ? Number(row.value) : 0
		for (const migration of MIGRATIONS.slice(from)) sql.exec(migration)
		if (from < MIGRATIONS.length) {
			sql.exec(
				"INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
				String(MIGRATIONS.length),
			)
		}
	})
}
