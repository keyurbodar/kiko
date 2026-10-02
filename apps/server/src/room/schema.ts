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
