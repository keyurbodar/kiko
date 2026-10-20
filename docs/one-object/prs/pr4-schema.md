# PR 4: One schema

Branch `one-object/pr4-schema` from `one-object/pr2-owner-do`. It runs at the same time as PR 5.

## Draft description

**Merge three schemas into one, and stop paying for unused indexes**

After PR 2, the owner object still carries the room, user and agent schemas side by side: about 73 tables and 30 indexes. On Cloudflare, every index updated by a write counts as a row written.

This PR merges them into about 15 tables:
- **Composite primary keys** such as `(room_id, seq)`, using `WITHOUT ROWID` where the key identifies the row.
- **No secondary index** unless a measured query needs it.
- **Search keeps FTS5,** but writes a reply once, when the reply is final, instead of on every update.

| Warm prompt | Before | After |
|---|---:|---:|
| Rows written | ≤ 15 | ≤ 8 |

## Steps

1. **Use experiment C's result** for the FTS5 row cost. If one insert per reply costs more than 2 rows, batch the run's replies into one insert at the end of the run.
2. **List every table and index from PR 2.** For each, keep, merge or drop it, and record the reason in the PR.
3. **Write `owner/schema.ts`** as the single list of migration steps. Earlier steps are never edited; new steps are appended, as `AGENTS.md` requires.
4. **For each dropped index,** show the query that used it and its plan with `EXPLAIN QUERY PLAN`. Show it's still fast on a 10k-message room.

## Gate

- Whole prompt ≤ 8 rows, median of 5.
- The search and room log verify suites pass.
- No query in the room log does a full scan on a 10k-message room.

## Out of scope

The archive (PR 6).
