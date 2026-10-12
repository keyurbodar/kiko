import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { migrate } from "@yuki/durable/migrate"
import { AGENT_STEPS } from "../src/agent/schema"
import { ROOM_STEPS } from "../src/room/schema"
import { USER_STEPS } from "../src/user/schema"
import { sqlStorage } from "./sql-shim"

// A table's columns as a set, and its indexes. SQLite appends an added column at the end, so an upgraded
// table is compared by column name, not by position.
function schemaOf(db: Database) {
  const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      {
        columns: db
          .query<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }, []>(`PRAGMA table_info("${name}")`)
          .all()
          .map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        indexes: db.query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name").all(name).map((i) => i.name),
      },
    ]),
  )
}

// The storage an object's constructor migrates: the shim's SQL, with transactions run as plain calls.
function storageOn(db: Database): DurableObjectStorage {
  return { sql: sqlStorage(db), transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
}

test("a room created before the pending columns upgrades to the tables a fresh room has", () => {
  const old = new Database(":memory:")
  // The room as version 1 left it: its first step, the meta table, and a pending table from before the two columns.
  old.exec(ROOM_STEPS[0] as string)
  old.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  old.exec("INSERT INTO meta (key, value) VALUES ('schema_version', '1')")
  old.exec("CREATE TABLE pending (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, reply_to TEXT)")
  old.exec("INSERT INTO pending (id, seq, at, text) VALUES ('m1', 1, 0, 'kept')")

  migrate(storageOn(old), ROOM_STEPS)

  const fresh = new Database(":memory:")
  migrate(storageOn(fresh), ROOM_STEPS)
  expect(schemaOf(old)).toEqual(schemaOf(fresh))
  expect(old.query("SELECT text FROM pending").all()).toEqual([{ text: "kept" }])
  expect(old.query("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: String(ROOM_STEPS.length) })
})

test("an agent with a workers table from before the step count upgrades to the tables a fresh agent has", () => {
  const old = new Database(":memory:")
  // The workers table core/agent created before the steps column, and no version: an object that predates the lists.
  old.exec(`CREATE TABLE workers (
    n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL UNIQUE, task TEXT NOT NULL,
    conversation_id INTEGER, submission_id INTEGER, status TEXT NOT NULL, step TEXT, delivered INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resumes INTEGER NOT NULL DEFAULT 0
  ) STRICT`)

  migrate(storageOn(old), AGENT_STEPS)

  const fresh = new Database(":memory:")
  migrate(storageOn(fresh), AGENT_STEPS)
  expect(schemaOf(old)).toEqual(schemaOf(fresh))
})

test("a user object from before the list upgrades in place: rows stay, and the tables match a fresh user", () => {
  const old = new Database(":memory:")
  // Before this change a user object had no version table. It kept its version in settings, and its tables were
  // created on demand by the same statements the list now holds. So it starts from step 0 and must survive the rerun.
  for (const step of USER_STEPS) if (typeof step === "string") old.exec(step)
  old.exec("INSERT INTO settings (key, value) VALUES ('schema_version', '1'), ('theme', 'dark')")
  old.exec("INSERT INTO chats (room_id, title, updated_at) VALUES ('r1', 'plans', 5)")
  old.exec("INSERT INTO reminders (id, text, due_utc, tz, room_id, target, created_by, status, created_at) VALUES ('rem1', 'taxes', 9, 'UTC', 'r1', 'yuki', 'human', 'active', 0)")

  migrate(storageOn(old), USER_STEPS)

  const fresh = new Database(":memory:")
  migrate(storageOn(fresh), USER_STEPS)
  expect(schemaOf(old)).toEqual(schemaOf(fresh))
  expect(old.query("SELECT title FROM chats").all()).toEqual([{ title: "plans" }])
  expect(old.query("SELECT text FROM reminders").all()).toEqual([{ text: "taxes" }])
  expect(old.query("SELECT value FROM settings WHERE key = 'theme'").get()).toEqual({ value: "dark" })
  expect(old.query("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: String(USER_STEPS.length) })
})
