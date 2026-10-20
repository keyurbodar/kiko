import { DurableObject } from "cloudflare:workers"
import { scopedContext } from "../src/owner/context"
import { erase } from "../src/lib/erase"

export class T extends DurableObject {
  async fetch(): Promise<Response> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS owner_deadlines (scope TEXT PRIMARY KEY, at INTEGER NOT NULL)")
    const a = scopedContext(this.ctx, "room:owner:a", () => [])
    const b = scopedContext(this.ctx, "room:owner:b", () => [])
    for (const ctx of [a, b]) {
      ctx.storage.sql.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta VALUES ('schema_version','1');
        CREATE TABLE agents (id TEXT PRIMARY KEY);
        CREATE TABLE chats (id INTEGER PRIMARY KEY, agents TEXT, text TEXT);
        CREATE VIRTUAL TABLE search USING fts5(text, content='chats', content_rowid='id');
        CREATE TRIGGER chats_insert AFTER INSERT ON chats BEGIN INSERT INTO search(rowid,text) VALUES(new.id,new.text); END;
        CREATE TRIGGER chats_delete AFTER DELETE ON chats BEGIN INSERT INTO search(search,rowid,text) VALUES('delete',old.id,old.text); END;
        INSERT INTO chats (agents,text) VALUES ('agents','hello');
      `)
    }
    const sql = a.storage.sql
    const overlap = sql.exec("SELECT agents, text AS agents_alias FROM chats").one()
    const qualified = sql.exec("SELECT chats.agents FROM chats").one()
    const aliased = sql.exec("SELECT agents.agents FROM chats AS agents").one()
    const columns = sql.exec("PRAGMA table_info(chats)").toArray()
    const catalog = sql.exec("SELECT name, sql FROM sqlite_master WHERE name = ?", "chats").toArray()
    const found = sql.exec("SELECT chats.agents FROM chats JOIN search ON search.rowid = chats.id WHERE search MATCH ?", "hello").toArray()
    sql.exec("DELETE FROM chats")
    const deleted = sql.exec("SELECT rowid FROM search WHERE search MATCH ?", "hello").toArray()
    sql.exec("INSERT INTO chats (agents,text) VALUES ('agents','again')")
    erase(a.storage)
    return Response.json({ overlap, qualified, aliased, columns, catalog, found, deleted, a: sql.exec("SELECT * FROM chats").toArray(), b: b.storage.sql.exec("SELECT agents FROM chats").toArray(), bSearch: b.storage.sql.exec("SELECT rowid FROM search WHERE search MATCH ?", "hello").toArray(), tombstone: sql.exec("SELECT value FROM meta WHERE key = 'deleted'").one() })
  }
}
export default { fetch() { return new Response("ok") } }
