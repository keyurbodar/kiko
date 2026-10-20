// rowprobe: measure rows billed per storage operation.
// Every measurement drains the cursor with .toArray() then reads cursor.rowsWritten.

interface R {
  id: string;
  label: string;
  written: number | string;
  read: number | string;
  detail?: string;
}

export class Probe {
  private ctx: DurableObjectState;
  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/run") {
      const out = await this.runAll();
      return Response.json(out);
    }
    if (url.pathname === "/size") {
      return Response.json({ databaseSize: this.ctx.storage.sql.databaseSize });
    }
    if (url.pathname === "/run2") {
      return Response.json(await this.run2());
    }
    if (url.pathname === "/run3") {
      return Response.json(await this.run3());
    }
    return new Response("rowprobe ok\n");
  }

  async run3(): Promise<{ cases: R[]; notes: string[] }> {
    const cases: R[] = [];
    const notes: string[] = [];
    const add = (r: R) => cases.push(r);

    this.drop("c1");
    this.ctx.storage.sql.exec("CREATE TABLE c1(id INTEGER PRIMARY KEY, v TEXT)");
    let maxRows = 0;
    let maxParams = 0;
    for (const n of [1, 16, 32, 50, 64, 100, 128, 200]) {
      try {
        const tuples = Array.from({ length: n }, () => "(?, ?)").join(",");
        const binds: any[] = [];
        for (let i = 0; i < n; i++) binds.push(n * 1000 + i, "v");
        this.ctx.storage.sql.exec(`INSERT INTO c1(id, v) VALUES ${tuples}`, ...binds);
        maxRows = n;
        maxParams = n * 2;
      } catch {
        break;
      }
    }
    add({
      id: "B1",
      label: "max rows per multi-VALUES statement",
      written: "n/a",
      read: 0,
      detail: `largest ok = ${maxRows} rows / ${maxParams} bind params (2 per row); next size failed`,
    });

    const one = this.stmt("SELECT v FROM c1 WHERE id = ?", 1000);
    add({ id: "B2", label: "Point lookup by primary key", written: one.written, read: one.read, detail: "1 row returned" });

    this.drop("c2");
    this.ctx.storage.sql.exec(
      "CREATE TABLE c2(id INTEGER PRIMARY KEY, a TEXT, b TEXT, c TEXT, d TEXT, e TEXT, f TEXT, g TEXT, h TEXT, i TEXT, j TEXT)",
    );
    for (const col of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"])
      this.ctx.storage.sql.exec(`CREATE INDEX c2_${col} ON c2(${col})`);
    const ten = this.stmt(
      "INSERT INTO c2(id,a,b,c,d,e,f,g,h,i,j) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      1, "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    );
    add({ id: "B3", label: "INSERT one row, 10 secondary indexes", written: ten.written, read: ten.read });

    const kvSizes: Array<[string, any]> = [
      ["small object", { a: 1 }],
      ["100 KB string", "k".repeat(100 * 1024)],
      ["1 MB string", "k".repeat(1024 * 1024)],
    ];
    for (const [name, val] of kvSizes) {
      const before = this.ctx.storage.sql.databaseSize;
      this.ctx.storage.put("kv_" + name, val);
      const after = this.ctx.storage.sql.databaseSize;
      add({
        id: `B4.${name}`,
        label: `KV put ${name}`,
        written: "1 (documented)",
        read: 0,
        detail: `databaseSize delta = ${after - before} bytes`,
      });
    }

    this.drop("c3");
    this.ctx.storage.sql.exec("CREATE TABLE c3(id INTEGER PRIMARY KEY, v TEXT)");
    let sawWritten = 0;
    try {
      this.ctx.storage.transactionSync(() => {
        this.stmt("INSERT INTO c3(id,v) VALUES (1,'a')");
        sawWritten = this.stmt("INSERT INTO c3(id,v) VALUES (2,'b')").written;
        throw new Error("rollback on purpose");
      });
    } catch {}
    const remaining = this.ctx.storage.sql.exec("SELECT count(*) AS c FROM c3").one() as any;
    add({
      id: "B5",
      label: "Rolled-back transaction",
      written: sawWritten,
      read: 0,
      detail: `cursor reported ${sawWritten} rows written before rollback; rows actually kept = ${remaining.c}`,
    });

    this.drop("c4");
    this.ctx.storage.sql.exec(
      "CREATE TABLE c4(id INTEGER PRIMARY KEY, a TEXT NOT NULL DEFAULT 'd', b INTEGER DEFAULT 0, CHECK (b >= 0))",
    );
    const dflt = this.stmt("INSERT INTO c4(id) VALUES (1)");
    add({ id: "B6", label: "INSERT with DEFAULT/NOT NULL/CHECK constraints", written: dflt.written, read: dflt.read });

    notes.push(`databaseSize at end of run3 = ${this.ctx.storage.sql.databaseSize} bytes`);
    return { cases, notes };
  }

  // Round 2: gaps left by the first pass.
  async run2(): Promise<{ cases: R[]; notes: string[] }> {
    const cases: R[] = [];
    const notes: string[] = [];
    const add = (r: R) => cases.push(r);
    const guard = async (id: string, label: string, fn: () => R | Promise<R>) => {
      try {
        add(await fn());
      } catch (e: any) {
        add({ id, label, written: "ERROR", read: 0, detail: String(e && e.message ? e.message : e) });
      }
    };

    // multi-row insert in ONE statement: 100 rows via recursive CTE, 1 bind
    await guard("A1", "1 statement, 100 rows (recursive CTE, no per-row binds)", () => {
      this.drop("a1");
      this.ctx.storage.sql.exec("CREATE TABLE a1(id INTEGER PRIMARY KEY, v TEXT)");
      const s = this.stmt(
        "INSERT INTO a1(id, v) SELECT value, 'x' FROM (WITH RECURSIVE c(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM c WHERE value<100) SELECT value FROM c)",
      );
      return { id: "A1", label: "1 statement, 100 rows (recursive CTE)", written: s.written, read: s.read };
    });

    // 100 rows, 100 separate statements, one transaction
    await guard("A2", "100 statements, 1 row each, 1 transaction", () => {
      this.drop("a2");
      this.ctx.storage.sql.exec("CREATE TABLE a2(id INTEGER PRIMARY KEY, v TEXT)");
      let total = 0;
      const raw: number[] = [];
      this.ctx.storage.transactionSync(() => {
        for (let i = 0; i < 100; i++) {
          const w = this.stmt("INSERT INTO a2(id, v) VALUES (?, ?)", i, "v").written;
          total += w;
          if (i < 3) raw.push(w);
        }
      });
      return {
        id: "A2",
        label: "100 statements x 1 row, 1 transaction",
        written: total,
        read: 0,
        detail: `first 3 per-stmt rowsWritten=[${raw.join(",")}]`,
      };
    });

    // bind limit probe
    await guard("A3", "max bind parameters for one exec", () => {
      this.drop("a3");
      this.ctx.storage.sql.exec("CREATE TABLE a3(id INTEGER PRIMARY KEY, v TEXT)");
      let max = 0;
      for (const n of [64, 96, 100, 128, 150, 200, 255, 400]) {
        try {
          const tuples = Array.from({ length: n }, () => "(?, ?)").join(",");
          const binds: any[] = [];
          for (let i = 0; i < n; i++) binds.push(i, "v");
          this.ctx.storage.sql.exec(`INSERT INTO a3(id, v) VALUES ${tuples}`, ...binds);
          max = n * 2;
        } catch {
          break;
        }
      }
      return { id: "A3", label: "max bind params per statement (2 per row)", written: "n/a", read: 0, detail: `max ok = ${max} params (${max / 2} rows)` };
    });

    // delete row with 3 indexes
    await guard("A4", "DELETE row from table with 3 indexes", () => {
      this.drop("a4");
      this.ctx.storage.sql.exec("CREATE TABLE a4(id INTEGER PRIMARY KEY, a TEXT, b TEXT, c TEXT)");
      this.ctx.storage.sql.exec("CREATE INDEX a4a ON a4(a)");
      this.ctx.storage.sql.exec("CREATE INDEX a4b ON a4(b)");
      this.ctx.storage.sql.exec("CREATE INDEX a4c ON a4(c)");
      for (let i = 1; i <= 3; i++) this.stmt("INSERT INTO a4(id,a,b,c) VALUES (?,?,?,?)", i, "a"+i, "b"+i, "c"+i);
      const s = this.stmt("DELETE FROM a4 WHERE id = 1");
      return { id: "A4", label: "DELETE 1 row, table has 3 indexes", written: s.written, read: s.read };
    });

    // update indexed column vs non-indexed
    await guard("A5", "UPDATE indexed column on table with 1 index", () => {
      this.drop("a5");
      this.ctx.storage.sql.exec("CREATE TABLE a5(id INTEGER PRIMARY KEY, a TEXT, data TEXT)");
      this.ctx.storage.sql.exec("CREATE INDEX a5a ON a5(a)");
      this.stmt("INSERT INTO a5(id,a,data) VALUES (1,'x','d')");
      const idx = this.stmt("UPDATE a5 SET a = 'y' WHERE id = 1");
      const nonIdx = this.stmt("UPDATE a5 SET data = 'e' WHERE id = 1");
      return {
        id: "A5",
        label: "UPDATE indexed col vs non-indexed col (1 index)",
        written: idx.written,
        read: nonIdx.written,
        detail: `indexed col=${idx.written}, non-indexed col=${nonIdx.written} (read col holds second)`,
      };
    });

    // 1.9 MB update
    await guard("A6", "UPDATE one row to a new 1.9 MB value", () => {
      this.drop("a6");
      this.ctx.storage.sql.exec("CREATE TABLE a6(id INTEGER PRIMARY KEY, data TEXT)");
      this.stmt("INSERT INTO a6(id,data) VALUES (1, 'small')");
      const s = this.stmt("UPDATE a6 SET data = ? WHERE id = 1", "z".repeat(Math.floor(1.9 * 1024 * 1024)));
      return { id: "A6", label: "UPDATE one row to 1.9 MB", written: s.written, read: s.read };
    });

    // INSERT OR REPLACE over existing row
    await guard("A7", "INSERT OR REPLACE over an existing row", () => {
      this.drop("a7");
      this.ctx.storage.sql.exec("CREATE TABLE a7(id INTEGER PRIMARY KEY, v TEXT)");
      this.stmt("INSERT INTO a7(id,v) VALUES (1,'a')");
      const s = this.stmt("INSERT OR REPLACE INTO a7(id,v) VALUES (1,'b')");
      return { id: "A7", label: "INSERT OR REPLACE over existing row", written: s.written, read: s.read };
    });

    // upsert that actually changes
    await guard("A8", "Upsert DO UPDATE that changes the value", () => {
      this.drop("a8");
      this.ctx.storage.sql.exec("CREATE TABLE a8(id INTEGER PRIMARY KEY, v TEXT)");
      this.stmt("INSERT INTO a8(id,v) VALUES (1,'a')");
      const s = this.stmt(
        "INSERT INTO a8(id,v) VALUES (1,'b') ON CONFLICT(id) DO UPDATE SET v = excluded.v WHERE v IS NOT excluded.v",
      );
      return { id: "A8", label: "Upsert conflict -> DO UPDATE (value changes)", written: s.written, read: s.read };
    });

    // upsert insert path (no conflict)
    await guard("A9", "Upsert insert path (no conflict)", () => {
      const s = this.stmt(
        "INSERT INTO a8(id,v) VALUES (2,'c') ON CONFLICT(id) DO UPDATE SET v = excluded.v WHERE v IS NOT excluded.v",
      );
      return { id: "A9", label: "Upsert, no conflict (plain insert path)", written: s.written, read: s.read };
    });

    // FTS5 long docs to force segment merges
    await guard("A10", "FTS5 normal, 200 long docs (~2 KB each), one txn", () => {
      this.drop("a10");
      this.ctx.storage.sql.exec("CREATE VIRTUAL TABLE a10 USING fts5(body)");
      let total = 0;
      this.ctx.storage.transactionSync(() => {
        for (let i = 0; i < 200; i++) {
          const words = Array.from({ length: 300 }, (_, j) => "w" + ((i * 31 + j * 7) % 977)).join(" ");
          total += this.stmt("INSERT INTO a10(body) VALUES (?)", words).written;
        }
      });
      return {
        id: "A10",
        label: "FTS5 normal, 200 long docs (~2 KB), 1 txn",
        written: total,
        read: 0,
        detail: `amortized=${(total / 200).toFixed(3)} rows/doc`,
      };
    });

    // FTS5 optimise / merge cost visibility
    await guard("A11", "FTS5 'optimize' command cost", () => {
      const s = this.stmt("INSERT INTO a10(a10) VALUES ('optimize')");
      return { id: "A11", label: "FTS5 optimize command", written: s.written, read: s.read };
    });

    // external content: delete trigger path
    await guard("A12", "FTS5 external content: DELETE base row (delete trigger)", () => {
      this.ctx.storage.sql.exec(
        `CREATE TRIGGER IF NOT EXISTS msgs_ad AFTER DELETE ON msgs BEGIN
           INSERT INTO msgs_fts(msgs_fts, rowid, body) VALUES ('delete', old.id, old.body);
         END`,
      );
      const s = this.stmt("DELETE FROM msgs WHERE id = 1");
      return { id: "A12", label: "FTS5 external content: base DELETE + trigger", written: s.written, read: s.read };
    });

    // rows read: full scan
    await guard("A13", "SELECT full scan rowsRead on 100-row table", () => {
      const s = this.stmt("SELECT count(*) AS c FROM a2");
      const full = this.stmt("SELECT * FROM a2");
      return {
        id: "A13",
        label: "Full scan read cost (100 rows)",
        written: full.written,
        read: full.read,
        detail: `count(*)=${s.read} read; SELECT * returned ${full.n} rows, rowsWritten=${full.written}`,
      };
    });

    // several tables, index overhead, one txn
    await guard("A14", "One txn: 3 inserts into 3 tables each with 1 index", () => {
      for (const t of ["b1", "b2", "b3"]) {
        this.drop(t);
        this.ctx.storage.sql.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY, v TEXT)`);
        this.ctx.storage.sql.exec(`CREATE INDEX ${t}_v ON ${t}(v)`);
      }
      const raw: number[] = [];
      this.ctx.storage.transactionSync(() => {
        raw.push(this.stmt("INSERT INTO b1(id,v) VALUES (1,'a')").written);
        raw.push(this.stmt("INSERT INTO b2(id,v) VALUES (1,'b')").written);
        raw.push(this.stmt("INSERT INTO b3(id,v) VALUES (1,'c')").written);
      });
      return {
        id: "A14",
        label: "1 txn: 3 inserts / 3 tables / 1 index each",
        written: raw.reduce((a, b) => a + b, 0),
        read: 0,
        detail: `per-statement=[${raw.join(",")}]`,
      };
    });

    // implicit transaction: does each statement outside transactionSync cost extra?
    await guard("A15", "3 statements outside any explicit transaction", () => {
      this.drop("d1");
      this.ctx.storage.sql.exec("CREATE TABLE d1(id INTEGER PRIMARY KEY, v TEXT)");
      const w1 = this.stmt("INSERT INTO d1(id,v) VALUES (1,'a')").written;
      const w2 = this.stmt("INSERT INTO d1(id,v) VALUES (2,'b')").written;
      const w3 = this.stmt("INSERT INTO d1(id,v) VALUES (3,'c')").written;
      return {
        id: "A15",
        label: "3 inserts, autocommit (no explicit txn)",
        written: w1 + w2 + w3,
        read: 0,
        detail: `per-stmt=[${w1},${w2},${w3}]`,
      };
    });

    notes.push(
      `databaseSize at end of run2 = ${this.ctx.storage.sql.databaseSize} bytes`,
      "rowsRead/rowsWritten come from the cursor returned by ctx.storage.sql.exec after .toArray()",
    );
    return { cases, notes };
  }

  private stmt(sql: string, ...binds: any[]) {
    const cur = this.ctx.storage.sql.exec(sql, ...binds);
    const rows = cur.toArray();
    return { written: cur.rowsWritten, read: cur.rowsRead, n: rows.length };
  }

  private drop(name: string) {
    try {
      this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${name}`);
    } catch {}
  }

  async runAll(): Promise<{ cases: R[]; notes: string[] }> {
    const cases: R[] = [];
    const notes: string[] = [];
    const add = (r: R) => cases.push(r);
    const guard = async (id: string, label: string, fn: () => R | Promise<R>) => {
      try {
        add(await fn());
      } catch (e: any) {
        add({ id, label, written: "ERROR", read: 0, detail: String(e && e.message ? e.message : e) });
      }
    };

    // ---- 1. plain insert ----
    await guard("1", "INSERT one row, rowid table, no index", () => {
      this.drop("t1");
      this.ctx.storage.sql.exec("CREATE TABLE t1(id INTEGER PRIMARY KEY, data TEXT)");
      const s = this.stmt("INSERT INTO t1(id, data) VALUES (?, ?)", 1, "hello");
      return { id: "1", label: "INSERT one row, rowid table, no index", written: s.written, read: s.read };
    });

    // ---- 2. secondary indexes ----
    for (const n of [1, 2, 3]) {
      await guard(`2.${n}`, `INSERT one row with ${n} secondary index(es)`, () => {
        const tbl = `t2_${n}`;
        this.drop(tbl);
        this.ctx.storage.sql.exec(`CREATE TABLE ${tbl}(id INTEGER PRIMARY KEY, a TEXT, b TEXT, c TEXT, data TEXT)`);
        const cols = ["a", "b", "c"].slice(0, n);
        for (const c of cols) this.ctx.storage.sql.exec(`CREATE INDEX ${tbl}_${c} ON ${tbl}(${c})`);
        const vals = cols.map((c) => "v" + c);
        const s = this.stmt(
          `INSERT INTO ${tbl}(id, ${cols.join(", ")}, data) VALUES (?, ${cols.map(() => "?").join(", ")}, ?)`,
          1,
          ...vals,
          "hello",
        );
        return { id: `2.${n}`, label: `INSERT one row with ${n} secondary index(es)`, written: s.written, read: s.read };
      });
    }

    // ---- 3. WITHOUT ROWID composite PK ----
    await guard("3", "INSERT into WITHOUT ROWID composite PK (room TEXT, seq INTEGER)", () => {
      this.drop("t3");
      this.ctx.storage.sql.exec(
        "CREATE TABLE t3(room TEXT, seq INTEGER, data TEXT, PRIMARY KEY(room, seq)) WITHOUT ROWID",
      );
      const s = this.stmt("INSERT INTO t3(room, seq, data) VALUES (?, ?, ?)", "r1", 1, "hello");
      return { id: "3", label: "INSERT WITHOUT ROWID composite PK", written: s.written, read: s.read };
    });

    // ---- 4. big values ----
    const sizes: Array<[string, number]> = [
      ["100 KB", 100 * 1024],
      ["1 MB", 1024 * 1024],
      ["1.9 MB", Math.floor(1.9 * 1024 * 1024)],
    ];
    for (const [name, n] of sizes) {
      for (const kind of ["TEXT", "BLOB"] as const) {
        await guard(`4.${name}.${kind}`, `INSERT one row with ${name} ${kind} value`, () => {
          const tbl = "t4";
          this.drop(tbl);
          this.ctx.storage.sql.exec(`CREATE TABLE ${tbl}(id INTEGER PRIMARY KEY, data ${kind})`);
          const v = kind === "TEXT" ? "a".repeat(n) : new Uint8Array(n).fill(97);
          const s = this.stmt(`INSERT INTO ${tbl}(id, data) VALUES (?, ?)`, 1, v);
          return {
            id: `4.${name}.${kind}`,
            label: `INSERT ${name} ${kind}`,
            written: s.written,
            read: s.read,
            detail: `payload bytes=${n}`,
          };
        });
      }
    }

    // ---- 5. updates ----
    await guard("5a", "UPDATE existing row, new 100 KB value", () => {
      this.drop("t5");
      this.ctx.storage.sql.exec("CREATE TABLE t5(id INTEGER PRIMARY KEY, value TEXT)");
      this.stmt("INSERT INTO t5(id, value) VALUES (?, ?)", 1, "small");
      const big = "b".repeat(100 * 1024);
      const s = this.stmt("UPDATE t5 SET value = ? WHERE id = ?", big, 1);
      return { id: "5a", label: "UPDATE one row (new 100 KB value)", written: s.written, read: s.read };
    });

    await guard("5b", "UPDATE no-op (value IS NOT excluded.value fails)", () => {
      this.drop("t5b");
      this.ctx.storage.sql.exec("CREATE TABLE t5b(id INTEGER PRIMARY KEY, value TEXT)");
      this.stmt("INSERT INTO t5b(id, value) VALUES (?, ?)", 1, "same");
      const s = this.stmt(
        "INSERT INTO t5b(id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value WHERE value IS NOT excluded.value",
        1,
        "same",
      );
      return {
        id: "5b",
        label: "Upsert no-op (WHERE value IS NOT excluded.value)",
        written: s.written,
        read: s.read,
      };
    });

    await guard("5c", "UPDATE no-op control: plain UPDATE SET same value", () => {
      const s = this.stmt("UPDATE t5b SET value = 'same' WHERE id = 1");
      return { id: "5c", label: "Plain UPDATE, same value (control)", written: s.written, read: s.read };
    });

    // ---- 6. deletes ----
    await guard("6a", "DELETE one row", () => {
      this.drop("t6");
      this.ctx.storage.sql.exec("CREATE TABLE t6(id INTEGER PRIMARY KEY, data TEXT)");
      for (let i = 1; i <= 20; i++) this.stmt("INSERT INTO t6(id, data) VALUES (?, ?)", i, "x");
      const s = this.stmt("DELETE FROM t6 WHERE id = 1");
      return { id: "6a", label: "DELETE one row", written: s.written, read: s.read };
    });

    await guard("6b", "DELETE 10 rows in one statement", () => {
      const s = this.stmt("DELETE FROM t6 WHERE id BETWEEN 2 AND 11");
      return { id: "6b", label: "DELETE 10 rows in one statement", written: s.written, read: s.read };
    });

    // ---- 7. FTS5 ----
    // (a) normal fts5, one 200-char doc
    await guard("7a", "FTS5 normal table, insert one 200-char doc", () => {
      this.drop("fts_a");
      this.ctx.storage.sql.exec("CREATE VIRTUAL TABLE fts_a USING fts5(body)");
      const doc = "word ".repeat(40).slice(0, 200);
      const s = this.stmt("INSERT INTO fts_a(body) VALUES (?)", doc);
      return { id: "7a", label: "FTS5 normal, 1 doc (200 chars)", written: s.written, read: s.read };
    });

    // (b) 10 docs one txn vs 10 separate txns
    await guard("7b.txn", "FTS5 normal, 10 docs in ONE transactionSync", () => {
      this.drop("fts_b1");
      this.ctx.storage.sql.exec("CREATE VIRTUAL TABLE fts_b1 USING fts5(body)");
      let total = 0;
      let perDoc = 0;
      const docs = Array.from({ length: 10 }, (_, i) => "doc " + i + " " + "lorem ipsum ".repeat(8));
      this.ctx.storage.transactionSync(() => {
        for (const d of docs) {
          const s = this.stmt("INSERT INTO fts_b1(body) VALUES (?)", d);
          total += s.written;
          perDoc = s.written;
        }
      });
      return {
        id: "7b.txn",
        label: "FTS5 normal, 10 docs, one transaction",
        written: total,
        read: 0,
        detail: `per-doc=${perDoc}, amortized=${(total / 10).toFixed(2)} rows/doc`,
      };
    });

    await guard("7b.separate", "FTS5 normal, 10 docs in 10 transactions", () => {
      this.drop("fts_b2");
      this.ctx.storage.sql.exec("CREATE VIRTUAL TABLE fts_b2 USING fts5(body)");
      let total = 0;
      const docs = Array.from({ length: 10 }, (_, i) => "doc " + i + " " + "lorem ipsum ".repeat(8));
      for (const d of docs) {
        let w = 0;
        this.ctx.storage.transactionSync(() => {
          w = this.stmt("INSERT INTO fts_b2(body) VALUES (?)", d).written;
        });
        total += w;
      }
      return {
        id: "7b.separate",
        label: "FTS5 normal, 10 docs, 10 transactions",
        written: total,
        read: 0,
        detail: `amortized=${(total / 10).toFixed(2)} rows/doc`,
      };
    });

    // (c) 500 docs one txn
    await guard("7c", "FTS5 normal, 500 docs in ONE transaction", () => {
      this.drop("fts_c");
      this.ctx.storage.sql.exec("CREATE VIRTUAL TABLE fts_c USING fts5(body)");
      let total = 0;
      this.ctx.storage.transactionSync(() => {
        for (let i = 0; i < 500; i++) {
          total += this.stmt(
            "INSERT INTO fts_c(body) VALUES (?)",
            `doc ${i} ` + "alpha beta gamma delta ".repeat(4),
          ).written;
        }
      });
      return {
        id: "7c",
        label: "FTS5 normal, 500 docs, one transaction",
        written: total,
        read: 0,
        detail: `amortized=${(total / 500).toFixed(3)} rows/doc`,
      };
    });

    // (c2) 500 docs separate statements but one txn? already c. Add 500 rows in one INSERT VALUES stmt for comparison.
    await guard("7c2", "FTS5 normal, 500 docs in ONE INSERT VALUES statement", () => {
      this.drop("fts_c2");
      this.ctx.storage.sql.exec("CREATE VIRTUAL TABLE fts_c2 USING fts5(body)");
      const tuples: string[] = [];
      const binds: any[] = [];
      for (let i = 0; i < 500; i++) {
        tuples.push("(?)");
        binds.push(`doc ${i} ` + "alpha beta gamma delta ".repeat(4));
      }
      const s = this.stmt(`INSERT INTO fts_c2(body) VALUES ${tuples.join(",")}`, ...binds);
      return {
        id: "7c2",
        label: "FTS5 normal, 500 docs, one multi-VALUES statement",
        written: s.written,
        read: s.read,
        detail: `amortized=${(s.written / 500).toFixed(3)} rows/doc`,
      };
    });

    // (d) external content + trigger
    await guard("7d", "FTS5 external content, base insert + AFTER INSERT trigger", () => {
      this.drop("msgs_fts");
      this.drop("msgs");
      this.ctx.storage.sql.exec("CREATE TABLE msgs(id INTEGER PRIMARY KEY, body TEXT)");
      this.ctx.storage.sql.exec(
        "CREATE VIRTUAL TABLE msgs_fts USING fts5(body, content='msgs', content_rowid='id')",
      );
      this.ctx.storage.sql.exec(
        `CREATE TRIGGER msgs_ai AFTER INSERT ON msgs BEGIN
           INSERT INTO msgs_fts(rowid, body) VALUES (new.id, new.body);
         END`,
      );
      const doc = "hello world " + "lorem ipsum ".repeat(12);
      const s = this.stmt("INSERT INTO msgs(id, body) VALUES (?, ?)", 1, doc);
      // control: insert into base table with trigger disabled by direct fts insert cost
      const direct = this.stmt("INSERT INTO msgs_fts(rowid, body) VALUES (?, ?)", 99, doc);
      return {
        id: "7d",
        label: "FTS5 external content: base INSERT incl. trigger",
        written: s.written,
        read: s.read,
        detail: `direct fts5 insert alone = ${direct.written} rows`,
      };
    });

    // (e) contentless
    await guard("7e", "FTS5 contentless (content='') insert one doc", () => {
      this.drop("fts_e");
      this.ctx.storage.sql.exec("CREATE VIRTUAL TABLE fts_e USING fts5(body, content='')");
      const doc = "word ".repeat(40).slice(0, 200);
      const s = this.stmt("INSERT INTO fts_e(body) VALUES (?)", doc);
      return { id: "7e", label: "FTS5 contentless, 1 doc", written: s.written, read: s.read };
    });

    // ---- 8. multiple tables in one txn ----
    await guard("8", "3 INSERTs into 3 tables in one transactionSync", () => {
      for (const t of ["m1", "m2", "m3"]) {
        this.drop(t);
        this.ctx.storage.sql.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY, v TEXT)`);
      }
      const raw: number[] = [];
      this.ctx.storage.transactionSync(() => {
        raw.push(this.stmt("INSERT INTO m1(id, v) VALUES (1, 'a')").written);
        raw.push(this.stmt("INSERT INTO m2(id, v) VALUES (1, 'b')").written);
        raw.push(this.stmt("INSERT INTO m3(id, v) VALUES (1, 'c')").written);
      });
      return {
        id: "8",
        label: "3 inserts / 3 tables / 1 transaction",
        written: raw.reduce((a, b) => a + b, 0),
        read: 0,
        detail: `raw per-statement rowsWritten=[${raw.join(", ")}] (1,1,1 means per-statement not cumulative)`,
      };
    });

    // ---- 9. trigger write counted? ----
    await guard("9", "AFTER INSERT trigger writing another table counted in rowsWritten?", () => {
      this.drop("trg_log");
      this.drop("trg_main");
      this.ctx.storage.sql.exec("CREATE TABLE trg_main(id INTEGER PRIMARY KEY, v TEXT)");
      this.ctx.storage.sql.exec("CREATE TABLE trg_log(id INTEGER PRIMARY KEY, main_id INTEGER, v TEXT)");
      this.ctx.storage.sql.exec(
        `CREATE TRIGGER trg_ai AFTER INSERT ON trg_main BEGIN
           INSERT INTO trg_log(id, main_id, v) VALUES (new.id, new.id, new.v);
           INSERT INTO trg_log(id, main_id, v) VALUES (new.id + 1000, new.id, new.v);
         END`,
      );
      const s = this.stmt("INSERT INTO trg_main(id, v) VALUES (1, 'x')");
      const logCount = this.ctx.storage.sql.exec("SELECT count(*) AS c FROM trg_log").one() as any;
      return {
        id: "9",
        label: "INSERT base row, trigger inserts 2 rows elsewhere",
        written: s.written,
        read: s.read,
        detail: `trigger rows actually present=${logCount.c}; 1 means trigger writes NOT counted, 3 means counted`,
      };
    });

    // ---- 10. transaction overhead / no-op txn ----
    await guard("10a", "Empty transactionSync (no statements)", () => {
      const before = this.ctx.storage.sql.databaseSize;
      this.ctx.storage.transactionSync(() => {});
      const after = this.ctx.storage.sql.databaseSize;
      return {
        id: "10a",
        label: "Empty transactionSync",
        written: 0,
        read: 0,
        detail: `databaseSize ${before} -> ${after}`,
      };
    });

    await guard("10b", "1 INSERT outside vs inside a transaction", () => {
      this.drop("t10");
      this.ctx.storage.sql.exec("CREATE TABLE t10(id INTEGER PRIMARY KEY, v TEXT)");
      const outside = this.stmt("INSERT INTO t10(id, v) VALUES (1, 'a')").written;
      let inside = 0;
      const before = this.ctx.storage.sql.databaseSize;
      this.ctx.storage.transactionSync(() => {
        inside = this.stmt("INSERT INTO t10(id, v) VALUES (2, 'b')").written;
      });
      const after = this.ctx.storage.sql.databaseSize;
      return {
        id: "10b",
        label: "1 INSERT outside vs inside txn",
        written: inside,
        read: 0,
        detail: `outside=${outside}, inside=${inside}, dbSize ${before}->${after}`,
      };
    });

    // 100 rows: one statement vs 100 statements, both in one txn (per-row vs per-statement)
    await guard("10c", "100 rows: 1 multi-VALUES stmt vs 100 stmts (one txn each)", () => {
      this.drop("t10c");
      this.ctx.storage.sql.exec("CREATE TABLE t10c(id INTEGER PRIMARY KEY, v TEXT)");
      const tuples: string[] = [];
      const binds: any[] = [];
      for (let i = 0; i < 100; i++) {
        tuples.push("(?, ?)");
        binds.push(i, "v" + i);
      }
      const oneStmt = this.stmt(`INSERT INTO t10c(id, v) VALUES ${tuples.join(",")}`, ...binds);
      this.drop("t10d");
      this.ctx.storage.sql.exec("CREATE TABLE t10d(id INTEGER PRIMARY KEY, v TEXT)");
      let many = 0;
      this.ctx.storage.transactionSync(() => {
        for (let i = 0; i < 100; i++) many += this.stmt("INSERT INTO t10d(id, v) VALUES (?, ?)", i, "v" + i).written;
      });
      return {
        id: "10c",
        label: "100 rows: 1 statement vs 100 statements (same txn)",
        written: oneStmt.written,
        read: many,
        detail: `one stmt=${oneStmt.written} rows, 100 stmts=${many} rows (read column holds 100-stmt total)`,
      };
    });

    // ---- 11. DDL cost (informational) ----
    await guard("11", "CREATE TABLE cost (informational)", () => {
      this.drop("t11");
      const s = this.stmt("CREATE TABLE t11(id INTEGER PRIMARY KEY, v TEXT)");
      return { id: "11", label: "CREATE TABLE (informational)", written: s.written, read: s.read };
    });

    // ---- 12. setAlarm / KV via databaseSize ----
    await guard("12a", "setAlarm: rows billed (documented = 1)", () => {
      const before = this.ctx.storage.sql.databaseSize;
      this.ctx.storage.setAlarm(Date.now() + 3_600_000);
      const after = this.ctx.storage.sql.databaseSize;
      return {
        id: "12a",
        label: "setAlarm()",
        written: "1 (documented)",
        read: 0,
        detail: `databaseSize ${before} -> ${after} (delta ${after - before} bytes)`,
      };
    });

    await guard("12b", "KV put: rows billed (documented = 1 row in hidden table)", () => {
      const before = this.ctx.storage.sql.databaseSize;
      this.ctx.storage.put("probe_kv", { hello: "world" });
      const after = this.ctx.storage.sql.databaseSize;
      return {
        id: "12b",
        label: "KV put()",
        written: "1 (documented)",
        read: 0,
        detail: `databaseSize ${before} -> ${after} (delta ${after - before} bytes)`,
      };
    });

    await guard("12c", "KV delete: rows billed (documented = 1)", () => {
      const before = this.ctx.storage.sql.databaseSize;
      this.ctx.storage.delete("probe_kv");
      const after = this.ctx.storage.sql.databaseSize;
      return {
        id: "12c",
        label: "KV delete()",
        written: "1 (documented)",
        read: 0,
        detail: `databaseSize ${before} -> ${after} (delta ${after - before} bytes)`,
      };
    });

    notes.push(
      `databaseSize at end = ${this.ctx.storage.sql.databaseSize} bytes`,
      "rowsWritten read from SqlStorageCursor after .toArray() drain",
      "each case uses a fresh table so prior rows do not perturb the counter",
    );

    return { cases, notes };
  }
}

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/run") {
      const id = env.PROBE.idFromName("probe");
      const stub = env.PROBE.get(id);
      return stub.fetch(new Request("https://do/run"));
    }
    if (url.pathname === "/size") {
      const id = env.PROBE.idFromName("probe");
      return env.PROBE.get(id).fetch(new Request("https://do/size"));
    }
    if (url.pathname === "/run2") {
      const id = env.PROBE.idFromName("probe");
      return env.PROBE.get(id).fetch(new Request("https://do/run2"));
    }
    if (url.pathname === "/run3") {
      const id = env.PROBE.idFromName("probe");
      return env.PROBE.get(id).fetch(new Request("https://do/run3"));
    }
    return new Response("rowprobe ok\n");
  },
};
