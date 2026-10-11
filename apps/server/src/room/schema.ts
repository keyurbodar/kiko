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
	CREATE INDEX events_kind_seq ON events (kind, seq);

	-- The current state of each message, with edits applied. sender, rich, and
	-- files are JSON. A deleted message keeps its row so ids are never reused.
	-- goto: another chat the message points at (architecture section 7.11).
	-- quote: the words of the replied-to message the human picked to answer.
	-- preview: the link card, removed on 2026-10-09; unread, kept so the table keeps its shape.
	-- tainted: 1 when a run that read outside content wrote it (section 16).
	-- addressed: who an agent's send_message or ask was for, so the client folds agent mail by fact.
	-- initiative: the one line a bubble shows when the agent spoke up unasked (section 26).
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
		goto TEXT,
		quote TEXT,
		preview TEXT,
		tainted INTEGER NOT NULL DEFAULT 0,
		addressed TEXT,
		initiative TEXT,
		UNIQUE (run_id, run_attempt, run_index)
	);
	CREATE INDEX messages_not_human ON messages (seq) WHERE json_extract(sender, '$.kind') != 'human';
	CREATE INDEX messages_agent ON messages (seq) WHERE json_extract(sender, '$.kind') = 'agent';
	CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='rowid');
	CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages WHEN new.deleted_at IS NULL BEGIN
		INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
	END;
	CREATE TRIGGER messages_fts_update AFTER UPDATE OF text, deleted_at ON messages BEGIN
		INSERT INTO messages_fts (messages_fts, rowid, text) SELECT 'delete', old.rowid, old.text WHERE old.deleted_at IS NULL;
		INSERT INTO messages_fts (rowid, text) SELECT new.rowid, new.text WHERE new.deleted_at IS NULL;
	END;

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

	-- The room's file index (files.ts). Bytes are in R2 under r2_key. A path holds
	-- one file. author is an actor key, as in events. width, height, and thumbhash are no longer
	-- written or read (2026-10-09); they stay so the table keeps its shape.
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

	-- The workspace (workspace.ts, architecture sections 4.3 and 7.6). Actors are actor keys, as in
	-- events. unblocked_seq is the event that finished a task's last open dependency; woken_at is set
	-- once its owner admitted the task_unblocked envelope, so the wake happens once.
	-- chain: the chain the task was made on (root, hop, authority), so its wakes keep the authority of
	-- the work the human asked for (section 25.3). Null on a task made before.
	-- tainted: 1 once a run that read outside content created or changed the task (section 26.6).
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
		woken_at INTEGER,
		chain TEXT,
		tainted INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE ws_task_deps (
		task_id TEXT NOT NULL,
		depends_on TEXT NOT NULL,
		PRIMARY KEY (task_id, depends_on)
	);
	CREATE INDEX ws_task_deps_on ON ws_task_deps (depends_on);

	-- Attachments the human uploaded when they picked them and has not sent yet (pending.ts,
	-- architecture section 18.1). sha256 is null while the bytes are on their way. upload_id is the
	-- R2 multipart upload of a big file. A send claims a row into ws_files; a sweep drops a stale one.
	CREATE TABLE pending_uploads (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		size INTEGER NOT NULL,
		r2_key TEXT NOT NULL,
		sha256 TEXT,
		upload_id TEXT,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX pending_uploads_created ON pending_uploads (created_at);
	`,
]

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
