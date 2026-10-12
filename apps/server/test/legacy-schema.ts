// Statements copied verbatim from main (the schema before U58) so the upgrade tests seed the shapes
// existing deployments hold. Generated from the source named in each list's comment. Do not edit by hand.
//
// USER: main's user/schema.ts version 1 and the tables main created on demand.
// ROOM: main's room/schema.ts version 1 (a single string), then the tables main created on demand. The
//   pending table is the one before the U52 columns (commit 20882060^).
// AGENT: the tables main created on demand. workers is the one before the steps column (commit c22a6086^).

// The user object's version 1 (main's user/schema.ts MIGRATIONS[0]).
export const LEGACY_USER_V1: string[] = [
  "CREATE TABLE IF NOT EXISTS chats (\n    room_id TEXT PRIMARY KEY,\n    title TEXT NOT NULL,\n    pinned INTEGER NOT NULL DEFAULT 0,\n    muted INTEGER NOT NULL DEFAULT 0,\n    last_seq INTEGER NOT NULL DEFAULT 0,\n    last_preview TEXT NOT NULL DEFAULT '',\n    unread INTEGER NOT NULL DEFAULT 0,\n    updated_at INTEGER NOT NULL,\n    agents TEXT NOT NULL DEFAULT '[]',\n    private INTEGER NOT NULL DEFAULT 0,\n    draft TEXT,\n    last TEXT,\n    mentions INTEGER NOT NULL DEFAULT 0,\n    grp INTEGER NOT NULL DEFAULT 0\n  )",
  "CREATE TABLE IF NOT EXISTS agents (\n    id TEXT PRIMARY KEY,\n    name TEXT NOT NULL,\n    slug TEXT NOT NULL UNIQUE,\n    prompt TEXT NOT NULL DEFAULT '',\n    model TEXT NOT NULL DEFAULT '',\n    created_at INTEGER NOT NULL\n  )",
  "CREATE TABLE IF NOT EXISTS rooms (room_id TEXT PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS user_events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS charged_today (id TEXT PRIMARY KEY, day TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS capture_queue (\n    room_id TEXT NOT NULL,\n    message_id TEXT NOT NULL,\n    text TEXT NOT NULL,\n    at INTEGER NOT NULL,\n    queued_at INTEGER NOT NULL,\n    PRIMARY KEY (room_id, message_id)\n  )",
  "CREATE TABLE IF NOT EXISTS loop_heard (\n    room_id TEXT NOT NULL,\n    message_id TEXT NOT NULL,\n    text TEXT NOT NULL,\n    at INTEGER NOT NULL,\n    agent TEXT NOT NULL DEFAULT '',\n    PRIMARY KEY (room_id, message_id)\n  )",
  "CREATE TABLE IF NOT EXISTS nap_applied (id TEXT PRIMARY KEY, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
]

// Tables main's user object created on demand.
export const LEGACY_USER_LAZY: string[] = [
  "CREATE TABLE IF NOT EXISTS wakeups (key TEXT PRIMARY KEY, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS souls (slug TEXT PRIMARY KEY, body TEXT NOT NULL, sha TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS reminders (\n      id TEXT PRIMARY KEY,\n      text TEXT NOT NULL,\n      due_utc INTEGER NOT NULL,\n      tz TEXT NOT NULL,\n      rrule TEXT,\n      room_id TEXT NOT NULL,\n      target TEXT NOT NULL,\n      created_by TEXT NOT NULL,\n      status TEXT NOT NULL,\n      last_fired INTEGER,\n      created_at INTEGER NOT NULL,\n      name TEXT,\n      \"trigger\" TEXT,\n      fails INTEGER NOT NULL DEFAULT 0,\n      watch_state TEXT,\n      hook_hash TEXT,\n      chain TEXT\n    )",
  "CREATE INDEX IF NOT EXISTS reminders_due ON reminders (status, due_utc)",
  "CREATE TABLE IF NOT EXISTS routine_runs (\n      routine_id TEXT NOT NULL,\n      occurrence TEXT NOT NULL,\n      started_at INTEGER NOT NULL,\n      ended_at INTEGER,\n      status TEXT NOT NULL,\n      seq INTEGER,\n      PRIMARY KEY (routine_id, occurrence)\n    )",
  "CREATE TABLE IF NOT EXISTS credentials (\n    provider_id TEXT PRIMARY KEY,\n    kind TEXT NOT NULL,\n    last4 TEXT NOT NULL,\n    kek_version INTEGER NOT NULL,\n    iv BLOB NOT NULL,\n    ciphertext BLOB NOT NULL,\n    updated_at INTEGER NOT NULL\n  )",
  "CREATE TABLE IF NOT EXISTS extensions (\n      name TEXT PRIMARY KEY,\n      hash TEXT NOT NULL,\n      bundle TEXT NOT NULL,\n      enabled INTEGER NOT NULL DEFAULT 1,\n      agents TEXT,\n      source TEXT NOT NULL,\n      by TEXT,\n      room TEXT,\n      error TEXT,\n      installed_at INTEGER NOT NULL,\n      updated_at INTEGER NOT NULL\n    )",
  "CREATE TABLE IF NOT EXISTS extension_proposals (\n      id TEXT PRIMARY KEY,\n      name TEXT NOT NULL,\n      hash TEXT NOT NULL,\n      bundle TEXT NOT NULL,\n      source TEXT NOT NULL,\n      by TEXT,\n      room TEXT,\n      created_at INTEGER NOT NULL\n    )",
  "CREATE TABLE IF NOT EXISTS extension_state (\n      extension TEXT NOT NULL,\n      scope TEXT NOT NULL,\n      key TEXT NOT NULL,\n      value TEXT NOT NULL,\n      PRIMARY KEY (extension, scope, key)\n    )",
  "CREATE TABLE IF NOT EXISTS extension_secrets (\n      extension TEXT NOT NULL,\n      secret TEXT NOT NULL,\n      kek_version INTEGER NOT NULL,\n      iv BLOB NOT NULL,\n      ciphertext BLOB NOT NULL,\n      PRIMARY KEY (extension, secret)\n    )",
  "CREATE TABLE IF NOT EXISTS composio (\n      name TEXT PRIMARY KEY,\n      kek_version INTEGER,\n      iv BLOB,\n      ciphertext BLOB,\n      value TEXT,\n      updated_at INTEGER NOT NULL\n    )",
  "CREATE TABLE IF NOT EXISTS kernel (\n      name TEXT PRIMARY KEY,\n      kek_version INTEGER,\n      iv BLOB,\n      ciphertext BLOB,\n      value TEXT,\n      updated_at INTEGER NOT NULL\n    )",
  "CREATE TABLE IF NOT EXISTS kernel_lease (\n      id INTEGER PRIMARY KEY CHECK (id = 1),\n      session_id TEXT NOT NULL,\n      mode TEXT NOT NULL,\n      kek_version INTEGER NOT NULL,\n      iv BLOB NOT NULL,\n      ciphertext BLOB NOT NULL,\n      created_at INTEGER NOT NULL,\n      last_use INTEGER NOT NULL,\n      tabs TEXT NOT NULL DEFAULT '{}',\n      takeover INTEGER NOT NULL DEFAULT 0,\n      watch_until INTEGER NOT NULL DEFAULT 0,\n      dead INTEGER NOT NULL DEFAULT 0\n    )",
  "CREATE TABLE IF NOT EXISTS deletion_rooms (room_id TEXT PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS attention (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS attention_seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS initiative_marks (id TEXT PRIMARY KEY, surfaced INTEGER NOT NULL DEFAULT 0, ignored INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, last_at INTEGER)",
  "CREATE TABLE IF NOT EXISTS initiative_wakes (id TEXT PRIMARY KEY, room TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL, ids TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS initiative_rooms (room_id TEXT PRIMARY KEY, human_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS loop_reminders (reminder_id TEXT PRIMARY KEY, loop_id INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS initiative_briefed (loop_id INTEGER PRIMARY KEY, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS life (\n      pos INTEGER PRIMARY KEY,\n      at INTEGER NOT NULL,\n      text TEXT NOT NULL,\n      source TEXT NOT NULL DEFAULT '',\n      norm TEXT NOT NULL,\n      pinned INTEGER NOT NULL DEFAULT 0,\n      redacted INTEGER NOT NULL DEFAULT 0,\n      ref TEXT NOT NULL DEFAULT '',\n      superseded_by INTEGER,\n      card TEXT\n    )",
  "CREATE INDEX IF NOT EXISTS life_norm ON life (norm)",
  "CREATE INDEX IF NOT EXISTS life_ref ON life (ref)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS life_fts USING fts5(text)",
  "CREATE TABLE IF NOT EXISTS loops (\n      id INTEGER PRIMARY KEY,\n      kind TEXT NOT NULL,\n      certainty TEXT NOT NULL,\n      owner TEXT NOT NULL,\n      room TEXT NOT NULL DEFAULT '',\n      ref TEXT NOT NULL DEFAULT '',\n      due TEXT,\n      status TEXT NOT NULL DEFAULT 'open',\n      text TEXT NOT NULL,\n      norm TEXT NOT NULL,\n      source TEXT NOT NULL,\n      opened_at INTEGER NOT NULL,\n      last_seen INTEGER NOT NULL,\n      mentions INTEGER NOT NULL DEFAULT 1,\n      closed_at INTEGER,\n      snoozed_until INTEGER\n    )",
  "CREATE INDEX IF NOT EXISTS loops_live ON loops (status, owner)",
  "CREATE INDEX IF NOT EXISTS loops_ref ON loops (ref)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS loops_fts USING fts5(text)",
  "CREATE TABLE IF NOT EXISTS life_tree (size INTEGER NOT NULL, k INTEGER NOT NULL, text TEXT NOT NULL, at_from INTEGER NOT NULL, at_to INTEGER NOT NULL, PRIMARY KEY (size, k)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS life_tree_fails (size INTEGER NOT NULL, k INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (size, k)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS home_files (\n      id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, r2_key TEXT NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL,\n      sha256 TEXT NOT NULL, width INTEGER, height INTEGER, thumbhash TEXT, author TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS home_dirs (path TEXT PRIMARY KEY)",
]

// The room's version 1 (main's room/schema.ts MIGRATIONS[0]).
export const LEGACY_ROOM_V1 = "\n\t-- Every stored change a human can see. seq only increases and is never reused.\n\t-- actor is \"human\", \"agent:<slug>\", or \"system:<reason>\". payload is the event\n\t-- without seq and at, as JSON.\n\tCREATE TABLE events (\n\t\tseq INTEGER PRIMARY KEY AUTOINCREMENT,\n\t\tkind TEXT NOT NULL,\n\t\tat INTEGER NOT NULL,\n\t\tactor TEXT NOT NULL,\n\t\tpayload TEXT NOT NULL\n\t);\n\tCREATE INDEX events_kind_seq ON events (kind, seq);\n\n\t-- The current state of each message, with edits applied. sender, rich, and\n\t-- files are JSON. A deleted message keeps its row so ids are never reused.\n\t-- goto: another chat the message points at (architecture section 7.11).\n\t-- quote: the words of the replied-to message the human picked to answer.\n\t-- preview: the link card, removed on 2026-10-09; unread, kept so the table keeps its shape.\n\t-- tainted: 1 when a run that read outside content wrote it (section 16).\n\t-- addressed: who an agent's send_message or ask was for, so the client folds agent mail by fact.\n\t-- initiative: the one line a bubble shows when the agent spoke up unasked (section 26).\n\tCREATE TABLE messages (\n\t\tid TEXT PRIMARY KEY,\n\t\tseq INTEGER NOT NULL UNIQUE,\n\t\tat INTEGER NOT NULL,\n\t\tsender TEXT NOT NULL,\n\t\ttext TEXT NOT NULL,\n\t\trich TEXT,\n\t\treply_to TEXT,\n\t\tfiles TEXT,\n\t\trun_id TEXT,\n\t\trun_attempt INTEGER,\n\t\trun_index INTEGER,\n\t\tedited_at INTEGER,\n\t\tdeleted_at INTEGER,\n\t\tgoto TEXT,\n\t\tquote TEXT,\n\t\tpreview TEXT,\n\t\ttainted INTEGER NOT NULL DEFAULT 0,\n\t\taddressed TEXT,\n\t\tinitiative TEXT,\n\t\tUNIQUE (run_id, run_attempt, run_index)\n\t);\n\tCREATE INDEX messages_not_human ON messages (seq) WHERE json_extract(sender, '$.kind') != 'human';\n\tCREATE INDEX messages_agent ON messages (seq) WHERE json_extract(sender, '$.kind') = 'agent';\n\tCREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='rowid');\n\tCREATE TRIGGER messages_fts_insert AFTER INSERT ON messages WHEN new.deleted_at IS NULL BEGIN\n\t\tINSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);\n\tEND;\n\tCREATE TRIGGER messages_fts_update AFTER UPDATE OF text, deleted_at ON messages BEGIN\n\t\tINSERT INTO messages_fts (messages_fts, rowid, text) SELECT 'delete', old.rowid, old.text WHERE old.deleted_at IS NULL;\n\t\tINSERT INTO messages_fts (rowid, text) SELECT new.rowid, new.text WHERE new.deleted_at IS NULL;\n\tEND;\n\n\t-- One reaction per actor per message.\n\tCREATE TABLE reactions (\n\t\tmessage_id TEXT NOT NULL,\n\t\tactor TEXT NOT NULL,\n\t\temoji TEXT NOT NULL,\n\t\tat INTEGER NOT NULL,\n\t\tPRIMARY KEY (message_id, actor)\n\t);\n\n\t-- Send dedupe. A resent clientId gets the first ack and stores nothing.\n\tCREATE TABLE clients (\n\t\tclient_id TEXT NOT NULL UNIQUE,\n\t\tmessage_id TEXT NOT NULL,\n\t\tseq INTEGER NOT NULL\n\t);\n\n\t-- The room's file index (files.ts). Bytes are in R2 under r2_key. A path holds\n\t-- one file. author is an actor key, as in events. width, height, and thumbhash are no longer\n\t-- written or read (2026-10-09); they stay so the table keeps its shape.\n\tCREATE TABLE ws_files (\n\t\tid TEXT PRIMARY KEY,\n\t\tpath TEXT NOT NULL UNIQUE,\n\t\tr2_key TEXT NOT NULL,\n\t\tsize INTEGER NOT NULL,\n\t\ttype TEXT NOT NULL,\n\t\tsha256 TEXT NOT NULL,\n\t\twidth INTEGER,\n\t\theight INTEGER,\n\t\tthumbhash TEXT,\n\t\tauthor TEXT NOT NULL,\n\t\tat INTEGER NOT NULL\n\t);\n\n\t-- The workspace (workspace.ts, architecture sections 4.3 and 7.6). Actors are actor keys, as in\n\t-- events. unblocked_seq is the event that finished a task's last open dependency; woken_at is set\n\t-- once its owner admitted the task_unblocked envelope, so the wake happens once.\n\t-- chain: the chain the task was made on (root, hop, authority), so its wakes keep the authority of\n\t-- the work the human asked for (section 25.3). Null on a task made before.\n\t-- tainted: 1 once a run that read outside content created or changed the task (section 26.6).\n\tCREATE TABLE ws_tasks (\n\t\tid TEXT PRIMARY KEY,\n\t\ttitle TEXT NOT NULL,\n\t\tstatus TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'blocked', 'review', 'done', 'cancelled')),\n\t\towner TEXT,\n\t\tnote TEXT,\n\t\tcreated_by TEXT NOT NULL,\n\t\tcreated_seq INTEGER NOT NULL,\n\t\tupdated_at INTEGER NOT NULL,\n\t\tunblocked_seq INTEGER,\n\t\twoken_at INTEGER,\n\t\tchain TEXT,\n\t\ttainted INTEGER NOT NULL DEFAULT 0\n\t);\n\tCREATE TABLE ws_task_deps (\n\t\ttask_id TEXT NOT NULL,\n\t\tdepends_on TEXT NOT NULL,\n\t\tPRIMARY KEY (task_id, depends_on)\n\t);\n\tCREATE INDEX ws_task_deps_on ON ws_task_deps (depends_on);\n\n\t-- Attachments the human uploaded when they picked them and has not sent yet (pending.ts,\n\t-- architecture section 18.1). sha256 is null while the bytes are on their way. upload_id is the\n\t-- R2 multipart upload of a big file. A send claims a row into ws_files; a sweep drops a stale one.\n\tCREATE TABLE pending_uploads (\n\t\tid TEXT PRIMARY KEY,\n\t\tname TEXT NOT NULL,\n\t\ttype TEXT NOT NULL,\n\t\tsize INTEGER NOT NULL,\n\t\tr2_key TEXT NOT NULL,\n\t\tsha256 TEXT,\n\t\tupload_id TEXT,\n\t\tcreated_at INTEGER NOT NULL\n\t);\n\tCREATE INDEX pending_uploads_created ON pending_uploads (created_at);\n\t"

// Tables main's room object created on demand.
export const LEGACY_ROOM_LAZY: string[] = [
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
  "CREATE TABLE IF NOT EXISTS pending (\n\t\t\tid TEXT PRIMARY KEY,\n\t\t\tseq INTEGER NOT NULL,\n\t\t\tat INTEGER NOT NULL,\n\t\t\ttext TEXT NOT NULL,\n\t\t\treply_to TEXT\n\t\t)",
  "CREATE INDEX IF NOT EXISTS pending_at ON pending (at)",
  "CREATE TABLE IF NOT EXISTS members (\n\t\t\tslug TEXT PRIMARY KEY,\n\t\t\tname TEXT NOT NULL,\n\t\t\trole TEXT NOT NULL DEFAULT '',\n\t\t\tmodel TEXT NOT NULL DEFAULT '',\n\t\t\tlead INTEGER NOT NULL DEFAULT 0,\n\t\t\tstatus TEXT NOT NULL DEFAULT 'idle',\n\t\t\tadded_seq INTEGER NOT NULL,\n\t\t\tremoved_at INTEGER\n\t\t)",
  "CREATE TABLE IF NOT EXISTS agent_asks (\n      id TEXT PRIMARY KEY,\n      asker TEXT NOT NULL,\n      askee TEXT NOT NULL,\n      at INTEGER NOT NULL,\n      state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed')),\n      answer TEXT,\n      message_id TEXT,\n      answer_send TEXT\n    ) STRICT",
  "CREATE TABLE IF NOT EXISTS mem_turns (\n      pos INTEGER PRIMARY KEY,\n      key TEXT NOT NULL,\n      first_seq INTEGER,\n      last_seq INTEGER,\n      at INTEGER NOT NULL,\n      at_last INTEGER NOT NULL,\n      trace TEXT\n    ) STRICT",
  "CREATE INDEX IF NOT EXISTS mem_turns_seq ON mem_turns (first_seq)",
  "CREATE TABLE IF NOT EXISTS mem_did (slug TEXT NOT NULL, doing TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (slug, doing)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS mem_tree (size INTEGER NOT NULL, k INTEGER NOT NULL, text TEXT NOT NULL, at_from INTEGER NOT NULL, at_to INTEGER NOT NULL, PRIMARY KEY (size, k)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS mem_tree_fails (size INTEGER NOT NULL, k INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (size, k)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS routine_inflight (routine_id TEXT NOT NULL, occurrence TEXT NOT NULL, slug TEXT NOT NULL, seq INTEGER NOT NULL, started INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (routine_id, occurrence))",
  "CREATE TABLE IF NOT EXISTS signal_window (n INTEGER PRIMARY KEY, at INTEGER NOT NULL, signal TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS signal_more (id INTEGER PRIMARY KEY CHECK (id = 1), more INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS signal_results (n INTEGER PRIMARY KEY, signal TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS team_doing (slug TEXT PRIMARY KEY, doing TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS team_leases (path TEXT PRIMARY KEY, slug TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS held_wakes (id TEXT PRIMARY KEY, wake TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ws_files (\n      id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, r2_key TEXT NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL,\n      sha256 TEXT NOT NULL, width INTEGER, height INTEGER, thumbhash TEXT, author TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ws_dirs (path TEXT PRIMARY KEY)",
]

// Tables main's agent object created on demand.
export const LEGACY_AGENT: string[] = [
  "CREATE TABLE IF NOT EXISTS wakeups (key TEXT PRIMARY KEY, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS agent_home (id INTEGER PRIMARY KEY CHECK (id = 1), home TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS wakeups (key TEXT PRIMARY KEY, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS outbox (\n      run_id TEXT PRIMARY KEY,\n      attempt INTEGER NOT NULL,\n      cursor INTEGER NOT NULL,\n      blocks TEXT NOT NULL,\n      posted INTEGER NOT NULL,\n      ended INTEGER NOT NULL DEFAULT 0\n    ) STRICT",
  "CREATE TABLE IF NOT EXISTS harness_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS run_origin (id INTEGER PRIMARY KEY CHECK (id = 1), origin TEXT NOT NULL, started_at INTEGER NOT NULL, steered INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS inbox (\n      id TEXT PRIMARY KEY,\n      arrival INTEGER NOT NULL,\n      priority INTEGER NOT NULL,\n      envelope TEXT NOT NULL,\n      brief TEXT NOT NULL,\n      request_id TEXT,\n      submitted INTEGER NOT NULL DEFAULT 0,\n      in_flight_at INTEGER,\n      in_flight_by TEXT,\n      at INTEGER\n    ) STRICT",
  "CREATE INDEX IF NOT EXISTS inbox_open ON inbox (submitted, request_id, priority, arrival)",
  "CREATE TABLE IF NOT EXISTS inbox_state (id INTEGER PRIMARY KEY CHECK (id = 1), arrival INTEGER NOT NULL, pruned_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS workers (\n      n INTEGER PRIMARY KEY,\n      id TEXT NOT NULL UNIQUE,\n      task_id TEXT NOT NULL UNIQUE,\n      task TEXT NOT NULL,\n      conversation_id INTEGER,\n      submission_id INTEGER,\n      status TEXT NOT NULL,\n      step TEXT,\n      delivered INTEGER NOT NULL DEFAULT 0,\n      origin TEXT NOT NULL,\n      started_at INTEGER NOT NULL,\n      updated_at INTEGER NOT NULL,\n      resumes INTEGER NOT NULL DEFAULT 0\n    ) STRICT",
  "CREATE TABLE IF NOT EXISTS worker_changes (\n      work_id TEXT NOT NULL,\n      path TEXT NOT NULL,\n      PRIMARY KEY (work_id, path)\n    ) STRICT",
]
