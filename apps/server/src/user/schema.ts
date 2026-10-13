import { ALARM_STEPS } from "@kiko/durable/alarm"
import { addColumn, type Step } from "@kiko/durable/migrate"
import { fileIndexSteps, HOME_TABLES } from "../files/file-index"
import { LIFE_STEPS, LIFE_TRI_STEPS } from "@kiko/memory/life"
import { LOOPS_STEPS } from "@kiko/memory/loops"

// The user's tables, in one list. An object at version N runs only the steps after the first N. A step is
// appended, never edited or moved, and every step must be safe on a table that already exists. An object
// with no recorded version runs them all, so the first steps are CREATE ... IF NOT EXISTS.
export const USER_STEPS: Step[] = [
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
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
  "CREATE TABLE IF NOT EXISTS rooms (room_id TEXT PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS user_events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS charged_today (id TEXT PRIMARY KEY, day TEXT NOT NULL)",
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
  "CREATE TABLE IF NOT EXISTS nap_applied (id TEXT PRIMARY KEY, at INTEGER NOT NULL)",
  // Tables that earlier code created inside its class constructors or methods.
  "CREATE TABLE IF NOT EXISTS souls (slug TEXT PRIMARY KEY, body TEXT NOT NULL, sha TEXT NOT NULL, at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS reminders (
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
  )`,
  "CREATE INDEX IF NOT EXISTS reminders_due ON reminders (status, due_utc)",
  `CREATE TABLE IF NOT EXISTS routine_runs (
    routine_id TEXT NOT NULL,
    occurrence TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,
    seq INTEGER,
    PRIMARY KEY (routine_id, occurrence)
  )`,
  `CREATE TABLE IF NOT EXISTS credentials (
    provider_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    last4 TEXT NOT NULL,
    kek_version INTEGER NOT NULL,
    iv BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS extensions (
    name TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    bundle TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    agents TEXT,
    source TEXT NOT NULL,
    by TEXT,
    room TEXT,
    error TEXT,
    installed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS extension_proposals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hash TEXT NOT NULL,
    bundle TEXT NOT NULL,
    source TEXT NOT NULL,
    by TEXT,
    room TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS extension_state (
    extension TEXT NOT NULL,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (extension, scope, key)
  )`,
  `CREATE TABLE IF NOT EXISTS extension_secrets (
    extension TEXT NOT NULL,
    secret TEXT NOT NULL,
    kek_version INTEGER NOT NULL,
    iv BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    PRIMARY KEY (extension, secret)
  )`,
  "CREATE TABLE IF NOT EXISTS deletion_rooms (room_id TEXT PRIMARY KEY)",
  // The attention and initiative tables, created on demand by initiative/ before they joined this list.
  "CREATE TABLE IF NOT EXISTS attention (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS attention_seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS initiative_marks (id TEXT PRIMARY KEY, surfaced INTEGER NOT NULL DEFAULT 0, ignored INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, last_at INTEGER)",
  "CREATE TABLE IF NOT EXISTS initiative_wakes (id TEXT PRIMARY KEY, room TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL, ids TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS initiative_rooms (room_id TEXT PRIMARY KEY, human_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS loop_reminders (reminder_id TEXT PRIMARY KEY, loop_id INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS initiative_briefed (loop_id INTEGER PRIMARY KEY, at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS composio (
    name TEXT PRIMARY KEY,
    kek_version INTEGER,
    iv BLOB,
    ciphertext BLOB,
    value TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kernel (
    name TEXT PRIMARY KEY,
    kek_version INTEGER,
    iv BLOB,
    ciphertext BLOB,
    value TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kernel_lease (
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
  ...LIFE_STEPS,
  ...LOOPS_STEPS,
  ...fileIndexSteps(HOME_TABLES),
  ...ALARM_STEPS,
  // How many Jev passes a heard burst has failed (initiative-loops.ts). Past the last try, the two-word touch decides it.
  addColumn("loop_heard", "attempts", "INTEGER NOT NULL DEFAULT 0"),
  // Lookups that read every row of a table that only grows: the pinned lines and the tagged cards of the life log
  // (read on every agent turn), the reminders by how recently they fired, and the day's charged bursts.
  "CREATE INDEX IF NOT EXISTS life_pinned ON life (pos) WHERE pinned = 1",
  "CREATE INDEX IF NOT EXISTS life_card ON life (pos) WHERE card IS NOT NULL AND pinned = 0",
  "CREATE INDEX IF NOT EXISTS reminders_fired ON reminders (status, last_fired)",
  "CREATE INDEX IF NOT EXISTS charged_today_day ON charged_today (day)",
  // The seen-signal window is seven days of bursts, and each burst swept the whole table to trim it.
  "CREATE INDEX IF NOT EXISTS attention_seen_at ON attention_seen (at)",
  // Substring search of the life log, for a recall that the word index missed. Kept in step with life_fts by life.ts.
  ...LIFE_TRI_STEPS,
  // A webhook post finds its routine by the hash of its token.
  "CREATE INDEX IF NOT EXISTS reminders_hook ON reminders (hook_hash)",
  // initiative_wakes.ids holds the one loop id a wake carries, no longer a JSON list of it.
  "UPDATE initiative_wakes SET ids = json_extract(ids, '$[0]') WHERE ids LIKE '[%'",
  // The per-day charge ids of the retired turn and autonomous-run limits.
  "DROP TABLE IF EXISTS charged_today",
]
