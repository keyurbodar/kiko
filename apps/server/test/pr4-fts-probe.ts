import { Miniflare } from "miniflare"

const mf = new Miniflare({
  modules: true,
  compatibilityDate: "2026-07-01",
  script: `
export class Probe {
  constructor(ctx) { this.ctx = ctx; }
  async fetch() {
    const sql = this.ctx.storage.sql;
    const result = [];
    for (const options of ['', ', columnsize=0, detail=none', ', columnsize=0']) {
      sql.exec('DROP TABLE IF EXISTS messages_fts');
      sql.exec('DROP TABLE IF EXISTS messages');
      sql.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT NOT NULL)');
      sql.exec("CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='id'" + options + ")");
      sql.exec("CREATE TRIGGER messages_insert AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid,text) VALUES(new.id,new.text); END");
      sql.exec("CREATE TRIGGER messages_update AFTER UPDATE OF text ON messages BEGIN INSERT INTO messages_fts(messages_fts,rowid,text) VALUES('delete',old.id,old.text); INSERT INTO messages_fts(rowid,text) VALUES(new.id,new.text); END");
      const text = 'The quick brown fox recalls the room discussion and follows the human instructions. '.repeat(3).slice(0,200);
      const insert = sql.exec('INSERT INTO messages(text) VALUES(?)', text).rowsWritten;
      let fiveTransaction = 0;
      this.ctx.storage.transactionSync(() => { for(let i=0;i<5;i++) fiveTransaction += sql.exec('INSERT INTO messages(text) VALUES(?)', text).rowsWritten; });
      const fiveStatement = sql.exec('INSERT INTO messages(text) VALUES(?),(?),(?),(?),(?)',text,text,text,text,text).rowsWritten;
      const update = sql.exec('UPDATE messages SET text=? WHERE id=1',text+' changed').rowsWritten;
      const hits = sql.exec("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'instr*'").toArray().length;
      result.push({options,insert,fiveTransaction,fiveStatement,update,hits});
    }
    return Response.json(result);
  }
}
export default { fetch(request,env) { return env.PROBE.get(env.PROBE.idFromName('probe')).fetch(request); } }`,
  durableObjects: { PROBE: { className: "Probe", useSQLite: true } },
})
try {
  const result = await mf.dispatchFetch("http://localhost/")
  console.log(JSON.stringify(await result.json(), null, 2))
} finally {
  await mf.dispose()
}
