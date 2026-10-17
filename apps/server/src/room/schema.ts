import { ALARM_STEPS } from "@kiko/durable/alarm"
import { addColumn, dropColumn, type Step } from "@kiko/durable/migrate"
import { treeSteps } from "@kiko/memory/optmem"

// The room's tables, in one list. An object at version N runs only the steps after the first N. A step is
// appended, never edited or moved, and every step must be safe on a table that already exists.
export const ROOM_STEPS: Step[] = [
	`
	-- Every stored change a human can see. seq only increases and is never reused.
	-- actor is "human", "agent:<slug>", or "system:<reason>". payload is the event
	-- without seq and at, as JSON.
	CREATE TABLE IF NOT EXISTS events (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		kind TEXT NOT NULL,
		at INTEGER NOT NULL,
		actor TEXT NOT NULL,
		payload TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS events_kind_seq ON events (kind, seq);

	-- The current state of each message, with edits applied. sender, rich, and
	-- files are JSON. A deleted message keeps its row so ids are never reused.
	-- goto: another chat the message points at (architecture section 7.11).
	-- quote: the words of the replied-to message the human picked to answer.
	-- preview: the link card, removed on 2026-10-09; unread, kept so the table keeps its shape.
	-- tainted: 1 when a run that read outside content wrote it (section 16).
	-- addressed: who an agent's send_message or ask was for, so the client folds agent mail by fact.
	-- initiative: the one line a bubble shows when the agent spoke up unasked (section 26).
	CREATE TABLE IF NOT EXISTS messages (
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
	CREATE INDEX IF NOT EXISTS messages_not_human ON messages (seq) WHERE json_extract(sender, '$.kind') != 'human';
	CREATE INDEX IF NOT EXISTS messages_agent ON messages (seq) WHERE json_extract(sender, '$.kind') = 'agent';
	CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='rowid');
	CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages WHEN new.deleted_at IS NULL BEGIN
		INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
	END;
	CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF text, deleted_at ON messages BEGIN
		INSERT INTO messages_fts (messages_fts, rowid, text) SELECT 'delete', old.rowid, old.text WHERE old.deleted_at IS NULL;
		INSERT INTO messages_fts (rowid, text) SELECT new.rowid, new.text WHERE new.deleted_at IS NULL;
	END;

	-- One reaction per actor per message.
	CREATE TABLE IF NOT EXISTS reactions (
		message_id TEXT NOT NULL,
		actor TEXT NOT NULL,
		emoji TEXT NOT NULL,
		at INTEGER NOT NULL,
		PRIMARY KEY (message_id, actor)
	);

	-- Send dedupe. A resent clientId gets the first ack and stores nothing.
	CREATE TABLE IF NOT EXISTS clients (
		client_id TEXT NOT NULL UNIQUE,
		message_id TEXT NOT NULL,
		seq INTEGER NOT NULL
	);

	-- The room's file index (files.ts). Bytes are in R2 under r2_key. A path holds
	-- one file. author is an actor key, as in events. width, height, and thumbhash are no longer
	-- written or read (2026-10-09); they stay so the table keeps its shape.
	CREATE TABLE IF NOT EXISTS ws_files (
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
	CREATE TABLE IF NOT EXISTS ws_tasks (
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
	CREATE TABLE IF NOT EXISTS ws_task_deps (
		task_id TEXT NOT NULL,
		depends_on TEXT NOT NULL,
		PRIMARY KEY (task_id, depends_on)
	);
	CREATE INDEX IF NOT EXISTS ws_task_deps_on ON ws_task_deps (depends_on);

	-- Attachments the human uploaded when they picked them and has not sent yet (pending.ts,
	-- architecture section 18.1). sha256 is null while the bytes are on their way. upload_id is the
	-- R2 multipart upload of a big file. A send claims a row into ws_files; a sweep drops a stale one.
	CREATE TABLE IF NOT EXISTS pending_uploads (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		size INTEGER NOT NULL,
		r2_key TEXT NOT NULL,
		sha256 TEXT,
		upload_id TEXT,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS pending_uploads_created ON pending_uploads (created_at);
	`,
	// Tables that earlier code created inside its class constructors. The object's first boot now creates them here.
	"CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, at INTEGER NOT NULL)",
	"CREATE TABLE IF NOT EXISTS agent_chains (slug TEXT PRIMARY KEY, root_id TEXT NOT NULL, hop INTEGER NOT NULL, next_root_id TEXT, next_hop INTEGER, origin TEXT, next_origin TEXT)",
	"CREATE TABLE IF NOT EXISTS root_counts (root_id TEXT PRIMARY KEY, deliveries INTEGER NOT NULL, tripped INTEGER NOT NULL DEFAULT 0, at INTEGER)",
	"CREATE TABLE IF NOT EXISTS agent_sends (id TEXT PRIMARY KEY, send TEXT NOT NULL, at INTEGER)",
	"CREATE TABLE IF NOT EXISTS autonomous_runs (id INTEGER PRIMARY KEY CHECK (id = 1), day TEXT NOT NULL, runs INTEGER NOT NULL)",
	"CREATE TABLE IF NOT EXISTS stopped_roots (root_id TEXT PRIMARY KEY, at INTEGER)",
	"CREATE TABLE IF NOT EXISTS mail_refused (id TEXT PRIMARY KEY, at INTEGER NOT NULL)",
	"CREATE TABLE IF NOT EXISTS auto_taken (id TEXT PRIMARY KEY, day TEXT NOT NULL)",
	"CREATE TABLE IF NOT EXISTS mail_queue (n INTEGER PRIMARY KEY, sender TEXT NOT NULL, send TEXT NOT NULL, recipient TEXT)",
	"CREATE TABLE IF NOT EXISTS ended_runs (run_id TEXT PRIMARY KEY, at INTEGER NOT NULL)",
	`CREATE TABLE IF NOT EXISTS pending (
		id TEXT PRIMARY KEY,
		seq INTEGER NOT NULL,
		at INTEGER NOT NULL,
		text TEXT NOT NULL,
		reply_to TEXT,
		mentions TEXT NOT NULL DEFAULT '[]',
		held_until INTEGER
	)`,
	"CREATE INDEX IF NOT EXISTS pending_at ON pending (at)",
	// A room whose window was open before these columns came has the old table.
	addColumn("pending", "mentions", "TEXT NOT NULL DEFAULT '[]'"),
	addColumn("pending", "held_until", "INTEGER"),
	"CREATE TABLE IF NOT EXISTS held_wakes (id TEXT PRIMARY KEY, wake TEXT NOT NULL, at INTEGER NOT NULL)",
	"CREATE TABLE IF NOT EXISTS signal_window (n INTEGER PRIMARY KEY, at INTEGER NOT NULL, signal TEXT NOT NULL)",
	"CREATE TABLE IF NOT EXISTS signal_more (id INTEGER PRIMARY KEY CHECK (id = 1), more INTEGER NOT NULL)",
	"CREATE TABLE IF NOT EXISTS signal_results (n INTEGER PRIMARY KEY, signal TEXT NOT NULL)",
	"CREATE TABLE IF NOT EXISTS routine_inflight (routine_id TEXT NOT NULL, occurrence TEXT NOT NULL, slug TEXT NOT NULL, seq INTEGER NOT NULL, started INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (routine_id, occurrence))",
	`CREATE TABLE IF NOT EXISTS members (
		slug TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT '',
		model TEXT NOT NULL DEFAULT '',
		lead INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'idle',
		added_seq INTEGER NOT NULL,
		removed_at INTEGER
	)`,
	`CREATE TABLE IF NOT EXISTS agent_asks (
		id TEXT PRIMARY KEY,
		asker TEXT NOT NULL,
		askee TEXT NOT NULL,
		at INTEGER NOT NULL,
		state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed')),
		answer TEXT,
		message_id TEXT,
		answer_send TEXT
	) STRICT`,
	`CREATE TABLE IF NOT EXISTS mem_turns (
		pos INTEGER PRIMARY KEY,
		key TEXT NOT NULL,
		first_seq INTEGER,
		last_seq INTEGER,
		at INTEGER NOT NULL,
		at_last INTEGER NOT NULL,
		trace TEXT
	) STRICT`,
	"CREATE INDEX IF NOT EXISTS mem_turns_seq ON mem_turns (first_seq)",
	"CREATE TABLE IF NOT EXISTS mem_did (slug TEXT NOT NULL, doing TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (slug, doing)) WITHOUT ROWID",
	...treeSteps("mem_tree"),
	"CREATE TABLE IF NOT EXISTS team_doing (slug TEXT PRIMARY KEY, doing TEXT NOT NULL, at INTEGER NOT NULL)",
	"CREATE TABLE IF NOT EXISTS team_leases (path TEXT PRIMARY KEY, slug TEXT NOT NULL, at INTEGER NOT NULL)",
	// ws_files is in version 1 above. The index needs only its directory table here.
	"CREATE TABLE IF NOT EXISTS ws_dirs (path TEXT PRIMARY KEY)",
	...ALARM_STEPS,
	// Every human send reads the burst window in send order (warnBusyAgents), so the window needs the seq index
	// to stop at its first few rows, not sort every row. The start of the window needs held_until before at.
	"CREATE INDEX IF NOT EXISTS pending_seq ON pending (seq)",
	"CREATE INDEX IF NOT EXISTS pending_held ON pending (held_until, at)",
	// A run's end looks up its turn by key, and the deliveries sweep deletes by age. Neither had an index, so
	// each read the whole table.
	"CREATE INDEX IF NOT EXISTS mem_turns_key ON mem_turns (key)",
	"CREATE INDEX IF NOT EXISTS deliveries_at ON deliveries (at)",
	// The autonomous budget, held wakes and the held window are gone (single owner).
	"DROP TABLE IF EXISTS autonomous_runs",
	"DROP TABLE IF EXISTS auto_taken",
	"DROP TABLE IF EXISTS held_wakes",
	"DROP INDEX IF EXISTS pending_held",
	dropColumn("pending", "held_until"),
	// A system line's typed event (protocol SystemEvent), as JSON. A private event is never read for an agent, memory or search.
	addColumn("messages", "event", "TEXT"),
	// The typed activity of what a member is doing now (protocol Activity), as JSON, beside its doing text.
	addColumn("team_doing", "activity", "TEXT"),
	// Questions an agent asked the human with ask_human. The row is the truth the card and the waiting tool both read.
	`CREATE TABLE IF NOT EXISTS human_asks (
		id TEXT PRIMARY KEY,
		asker TEXT NOT NULL,
		question TEXT NOT NULL,
		options TEXT,
		message_id TEXT NOT NULL,
		at INTEGER NOT NULL,
		state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'skipped')),
		answer TEXT
	) STRICT`,
	addColumn("human_asks", "questions", "TEXT"),
	// The other room of a private talk. On an ask row, the room the ask went to (or came from). On a queued mail row, where to send it (JSON: room, ask id, and back for an answer).
	addColumn("agent_asks", "remote", "TEXT"),
	addColumn("mail_queue", "remote", "TEXT"),
	`CREATE TABLE IF NOT EXISTS ws_task_reports (
		seq INTEGER PRIMARY KEY,
		recipient TEXT NOT NULL,
		body TEXT NOT NULL,
		chain TEXT
	) STRICT`,
	// One finished tool call (architecture 9.5): one row, written when it ends. `after_seq` is the seq of the agent's message before it. No secondary index: each would cost a write.
	`CREATE TABLE IF NOT EXISTS run_steps (
		run_id TEXT NOT NULL,
		id TEXT NOT NULL,
		slug TEXT NOT NULL,
		tool TEXT NOT NULL,
		name TEXT NOT NULL,
		app TEXT,
		worker TEXT,
		label TEXT NOT NULL,
		input TEXT,
		status TEXT NOT NULL,
		started_at INTEGER NOT NULL,
		ended_at INTEGER NOT NULL,
		output TEXT,
		after_seq INTEGER NOT NULL,
		PRIMARY KEY (run_id, id)
	) WITHOUT ROWID`,
	addColumn("messages", "steps", "INTEGER"),
	addColumn("messages", "step_after", "INTEGER"),
	// The words a run wrote between two tool calls. They stay in the step pane, not in the chat.
	addColumn("run_steps", "note", "INTEGER"),
]
