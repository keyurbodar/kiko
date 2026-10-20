import { expect, test } from "bun:test"
import { erase } from "../src/lib/erase"
import { OWNER_STEPS } from "../src/owner/schema"
import { createAgent } from "../src/user/agents"
import { sqlWith } from "./sql-shim"
import { sqlStorage } from "./sql-shim"

test("erasing removes data and FTS contents, retains schema version, and is repeatable", () => {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT); CREATE VIRTUAL TABLE search USING fts5(text, content='messages', content_rowid='id'); CREATE TRIGGER removed AFTER DELETE ON messages BEGIN INSERT INTO search(search, rowid, text) VALUES ('delete', old.id, old.text); END;")
  sql.exec("CREATE VIRTUAL TABLE notes_fts USING fts5(text)")
  sql.exec("INSERT INTO notes_fts(text) VALUES ('private')")
  sql.exec("INSERT INTO meta VALUES ('schema_version', '5'), ('secret', 'private')")
  sql.exec("INSERT INTO messages VALUES (1, 'private')")
  sql.exec("INSERT INTO search(rowid, text) VALUES (1, 'private')")
  const storage = { sql, transactionSync: <T>(f: () => T) => f() } as DurableObjectStorage
  erase(storage)
  erase(storage)
  expect(sql.exec("SELECT * FROM notes_fts WHERE notes_fts MATCH 'private'").toArray()).toEqual([])
  expect(sql.exec("SELECT * FROM messages").toArray()).toEqual([])
  expect(sql.exec("SELECT * FROM search WHERE search MATCH 'private'").toArray()).toEqual([])
  expect(sql.exec("SELECT * FROM meta ORDER BY key").toArray()).toEqual([{ key: "deleted", value: "1" }, { key: "schema_version", value: "5" }])
})

test("deleted handles remain reserved after cleanup finishes", () => {
  const sql = sqlWith(OWNER_STEPS)
  sql.exec("INSERT INTO deleted_agent_handles (slug) VALUES ('radar')")
  sql.exec("INSERT INTO deletion_agents (slug) VALUES ('radar')")
  sql.exec("DELETE FROM deletion_agents WHERE slug = 'radar'")
  expect(createAgent(sql, { id: 'new', slug: 'radar' as never, name: 'Radar', prompt: '', model: '' }, 1)).toBeNull()
  expect(sql.exec("SELECT id FROM agents WHERE slug = 'radar'").toArray()).toEqual([])
})
