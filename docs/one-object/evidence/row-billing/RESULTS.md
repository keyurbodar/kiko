# rowprobe — rows billed per Durable Object SQL storage operation

Measured on `wrangler 4.146.0` (workerd local), the probe worker in this folder (`worker.ts`),
one SQLite-backed Durable Object, fresh table per case.

Method: after every `ctx.storage.sql.exec(...)`, drain the cursor (`.toArray()`) and read
`cursor.rowsWritten` / `cursor.rowsRead`. That is the same counter Cloudflare bills from.
Ops with no cursor (`setAlarm`, KV) are recorded from the documented rule and cross-checked
against `ctx.storage.sql.databaseSize` deltas.

Source: `worker.ts`. Raw output stayed in the local probe directory.

## Results

| # | Case | rowsWritten | rowsRead | Notes |
|---|------|------------:|---------:|-------|
| 1 | INSERT 1 row, `t(id INTEGER PRIMARY KEY, data TEXT)` | **1** | 1 | baseline |
| 2 | INSERT 1 row + 1 secondary index | **2** | 1 | |
| 2 | INSERT 1 row + 2 secondary indexes | **3** | 1 | |
| 2 | INSERT 1 row + 3 secondary indexes | **4** | 1 | |
| 2 | INSERT 1 row + 10 secondary indexes | **11** | 1 | linear: 1 + one row per index |
| 3 | INSERT into `WITHOUT ROWID` `(room TEXT, seq INTEGER)` composite PK | **1** | 0 | the PK *is* the table, still 1 |
| 4 | INSERT 1 row, 100 KB TEXT | **1** | 1 | |
| 4 | INSERT 1 row, 100 KB BLOB | **1** | 1 | |
| 4 | INSERT 1 row, 1 MB TEXT | **1** | 1 | |
| 4 | INSERT 1 row, 1 MB BLOB | **1** | 1 | |
| 4 | INSERT 1 row, 1.9 MB TEXT | **1** | 1 | |
| 4 | INSERT 1 row, 1.9 MB BLOB | **1** | 1 | payload size never matters |
| 5 | UPDATE 1 existing row → new 100 KB value | **1** | 1 | |
| 5 | UPDATE 1 existing row → new 1.9 MB value | **1** | 1 | |
| 5 | UPDATE non-indexed column, 1 index on table | **1** | 1 | |
| 5 | UPDATE indexed column, 1 index on table | **2** | 1 | index maintenance bills a row |
| 5 | Upsert no-op (`WHERE value IS NOT excluded.value`) | **0** | 1 | billed as read only |
| 5 | Plain `UPDATE SET value = <same>` (control) | **1** | 1 | SQLite rewrites even unchanged |
| 5 | Upsert that does change the value | **1** | 1 | |
| 5 | `INSERT OR REPLACE` over existing row | **1** | 1 | replace = delete+insert, still 1 |
| 6 | DELETE 1 row | **1** | 1 | |
| 6 | DELETE 10 rows, one statement | **10** | 11 | per row, not per statement |
| 6 | DELETE 1 row from table with 3 indexes | **1** | 1 | index removal not billed on delete |
| 7a | FTS5 normal table, 1 doc (200 chars) | **1** | 0 | 1.00 rows/doc |
| 7b | FTS5 normal, 10 docs in **one** `transactionSync` | **10** | 0 | 1.00 rows/doc |
| 7b | FTS5 normal, 10 docs in **10** transactions | **10** | 0 | 1.00 rows/doc, no txn overhead |
| 7c | FTS5 normal, 500 docs, one transaction | **500** | 0 | 1.000 rows/doc |
| 7c | FTS5 normal, 200 long docs (~2 KB), one txn | **200** | 0 | 1.000 rows/doc, no merge cost seen |
| 7c | FTS5 `optimize` command | **1** | 0 | merge work inside is not itemised |
| 7d | FTS5 external content (`content='msgs'`) + AFTER INSERT trigger | **2** | 1 | base row 1 + trigger's FTS write 1 |
| 7d | FTS5 external content, base DELETE + delete trigger | **2** | 1 | same shape |
| 7e | FTS5 contentless (`content=''`), 1 doc | **1** | 0 | 1.00 rows/doc |
| 8 | 3 INSERTs into 3 tables in one `transactionSync` | **3** | 0 | per-statement cursor values were 1,1,1 → sum, not cumulative |
| 8 | 1 txn: 3 inserts / 3 tables / 1 index each | **6** | 0 | per statement 2,2,2 → still pure sum |
| 9 | INSERT base row; AFTER INSERT trigger writes 2 rows elsewhere | **3** | 3 | 1 + 2: trigger writes **are** counted |
| 10 | INSERT 1 row outside vs inside a transaction | **1** / **1** | 0 | identical |
| 10 | Empty `transactionSync` | **0** | 0 | no per-txn cost |
| 10 | 100 rows in one statement (recursive-CTE insert) | **100** | 201 | 1.00 rows/row |
| – | 500 multi-VALUES rows, 500 binds in one statement | **ERROR** | – | `too many SQL variables`; cap is 100 params (see aside) |
| 10 | 100 rows: 100 statements, one transaction | **100** | 0 | 1.00 rows/row |
| 10 | 3 statements, autocommit (no explicit txn) | **3** | 0 | 1,1,1 |
| 11 | `CREATE TABLE` (informational DDL) | **2** | 1 | DDL writes sqlite_master rows |
| 12 | `setAlarm()` | **1** (documented) | – | `databaseSize` unchanged (alarm lives outside the SQL db) |
| 12 | KV `put("probe", …)` | **1** (documented) | – | `databaseSize` +4096 B (one hidden-table row grew a page) |
| 12 | KV `put` 100 KB string | **1** (documented) | – | `databaseSize` +102,400 B |
| 12 | KV `put` 1 MB string | **1** (documented) | – | `databaseSize` +1,052,672 B |
| 12 | KV `delete()` | **1** (documented) | – | `databaseSize` unchanged |
| – | Rolled-back transaction (2 writes, then throw) | **1** counted | 0 | counter reports 1 even though 0 rows survived; billing follows the counter, not the commit |
| – | Point lookup by PK | **0** | 1 | reads are free of write billing |
| – | Full scan of 100 rows | **0** | 100 | rowsRead scales with rows scanned |

## Bind-parameter ceiling (surprise, worth knowing)

One statement can bind at most **100 parameters**. A 50-row `INSERT … VALUES` with 2 columns
(100 params) succeeds; 64 rows (128 params) fails with `too many SQL variables`.
So batch inserts are capped at 100 binds per statement — this is why Kiko's list insert passes
one JSON value and uses `json_each(?)`.

## Conclusions

- **Billing is per row written, never per transaction, per statement, or per page.** An empty
  `transactionSync` costs 0; 1 row costs 1 whether autocommit, inside a transaction, or inside a
  million-row transaction; 10 rows in one statement costs 10. None of ~45 cases showed a fixed
  per-call cost — the only transaction effect is latency. The counter is also the truth rather than
  the commit: a transaction that wrote 1 row and then rolled back still reports 1.
- **Bytes are free; only cardinality is billed.** A 1.9 MB TEXT or BLOB value bills **1** row, same
  as `"hello"` — inline vs overflow pages, WAL frames, and page splits are invisible. Same for KV: a
  1 MB `put` bills the documented 1 row while growing `databaseSize` by 1,052,672 bytes. `setAlarm`
  bills 1 row and writes outside the SQL database entirely. Do not shred large values to "save rows";
  rows *read* on a scan scale with row count, not bytes.
- **One extra row per secondary index maintained, on INSERT and on indexed-column UPDATE.**
  1 index = 2 rows, 10 indexes = 11. Deleting a row does *not* charge for index removal (still 1),
  and `INSERT OR REPLACE` is 1. The write amplifier is `1 + (indexes touched)`, so the cheapest win
  on hot-insert tables is fewer indexes.
- **The upsert guard is free when it no-ops.** `ON CONFLICT … DO UPDATE … WHERE value IS NOT
  excluded.value` returning no change bills **0 rows written** (1 row read), while a plain
  `UPDATE SET same` bills 1. Re-delivering an idempotent message through that upsert costs nothing
  in writes — the biggest lever for an at-least-once delivery path.
- **Triggers are billed and FTS5 is exactly 1 row per document, flat.** A trigger's writes land in
  the parent statement's cursor (1 base + 2 trigger = 3 rows). Normal, external-content, and
  contentless FTS5 all cost **1.00 rows/doc** amortized — unchanged at 1 doc, 10 docs, 500 docs,
  ~2 KB docs, one transaction or ten — so external-content FTS5 on a message table is +1 row per
  message (2 total) and merge/shadow-table work never appears in the counter.

## Aside: one statement takes at most 100 bind parameters

50 two-column rows succeed; 64 rows (128 params) fails with `too many SQL variables`. Batch inserts
must pass one JSON value and read it with `json_each(?)`, not bind per row.

