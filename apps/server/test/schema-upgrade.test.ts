import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { migrate } from "@kiko/durable/migrate"
import { AGENT_STEPS } from "../src/agent/schema"
import { ROOM_STEPS } from "../src/room/schema"
import { USER_STEPS } from "../src/user/schema"
import { LEGACY_AGENT, LEGACY_ROOM_LAZY, LEGACY_ROOM_V1, LEGACY_USER_LAZY, LEGACY_USER_V1 } from "./legacy-schema"
import { sqlStorage } from "./sql-shim"

// Every table's columns by name, and its indexes. SQLite appends an added column at the end, so an upgraded
// table is compared by name, not by position.
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

// An object as main left it: its version 1 and the tables its code made on demand, with a version row where main kept one.
function legacy(statements: string[], version?: { table: "meta" | "settings"; value: string }) {
  const db = new Database(":memory:")
  for (const s of statements) db.exec(s)
  if (version) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${version.table} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    db.query(`INSERT INTO ${version.table} (key, value) VALUES ('schema_version', ?)`).run(version.value)
  }
  return db
}

test("a room from main upgrades to the tables and columns a fresh room has, and keeps its rows", () => {
  const old = legacy([LEGACY_ROOM_V1, ...LEGACY_ROOM_LAZY], { table: "meta", value: "1" })
  // The pending table has no mentions or held_until column: the shape from before the U52 columns.
  expect(old.query<{ name: string }, []>("PRAGMA table_info(pending)").all().map((c) => c.name)).toEqual(["id", "seq", "at", "text", "reply_to"])
  old.exec("INSERT INTO pending (id, seq, at, text) VALUES ('m1', 1, 0, 'kept')")
  old.exec("INSERT INTO events (kind, at, actor, payload) VALUES ('message', 1, 'human', '{}')")
  old.exec("INSERT INTO members (slug, name, added_seq) VALUES ('ada', 'Ada', 1)")

  migrate(storageOn(old), ROOM_STEPS)

  const fresh = legacy([])
  migrate(storageOn(fresh), ROOM_STEPS)
  expect(schemaOf(old)).toEqual(schemaOf(fresh))
  expect(old.query("SELECT id, text FROM pending").all()).toEqual([{ id: "m1", text: "kept" }])
  expect(old.query("SELECT kind FROM events").all()).toEqual([{ kind: "message" }])
  expect(old.query("SELECT name FROM members").all()).toEqual([{ name: "Ada" }])
  expect(old.query("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: String(ROOM_STEPS.length) })
})

test("a user from main upgrades in place: its rows stay, and its tables match a fresh user", () => {
  // Main's user object kept its version in settings and started from there. The new list has no version in settings,
  // so the object runs every step from 0. Its tables already exist, so each step must be safe to run again.
  const old = legacy([...LEGACY_USER_V1, ...LEGACY_USER_LAZY], undefined)
  old.exec("INSERT INTO settings (key, value) VALUES ('schema_version', '1'), ('theme', 'dark')")
  old.exec("INSERT INTO chats (room_id, title, updated_at) VALUES ('r1', 'plans', 5)")
  old.exec("INSERT INTO reminders (id, text, due_utc, tz, room_id, target, created_by, status, created_at) VALUES ('rem1', 'taxes', 9, 'UTC', 'r1', 'kiko', 'human', 'active', 0)")
  old.exec("INSERT INTO attention (name, value) VALUES ('rhythm', 'slow')")

  migrate(storageOn(old), USER_STEPS)

  const fresh = legacy([])
  migrate(storageOn(fresh), USER_STEPS)
  expect(schemaOf(old)).toEqual(schemaOf(fresh))
  expect(old.query("SELECT title FROM chats").all()).toEqual([{ title: "plans" }])
  expect(old.query("SELECT text FROM reminders").all()).toEqual([{ text: "taxes" }])
  expect(old.query("SELECT value FROM settings WHERE key = 'theme'").get()).toEqual({ value: "dark" })
  expect(old.query("SELECT value FROM attention WHERE name = 'rhythm'").get()).toEqual({ value: "slow" })
  expect(old.query("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: String(USER_STEPS.length) })
})

test("an agent from main upgrades to the tables and columns a fresh agent has, and keeps its workers", () => {
  // No version row, and workers without the steps column: the shape before c22a6086.
  const old = legacy(LEGACY_AGENT)
  expect(old.query<{ name: string }, []>("PRAGMA table_info(workers)").all().map((c) => c.name)).not.toContain("steps")
  old.exec("INSERT INTO workers (n, id, task_id, task, status, origin, started_at, updated_at) VALUES (1, 'w1', 'old-task', 'older work', 'done', 'human', 0, 0)")

  migrate(storageOn(old), AGENT_STEPS)

  const fresh = legacy([])
  migrate(storageOn(fresh), AGENT_STEPS)
  expect(schemaOf(old)).toEqual(schemaOf(fresh))
  expect(old.query("SELECT task, steps FROM workers").all()).toEqual([{ task: "older work", steps: 0 }])
})
