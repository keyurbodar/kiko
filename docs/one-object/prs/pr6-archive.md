# PR 6: R2 archive for old history

Branch `one-object/pr6-archive` from `one-object/pr4-schema`.

## Draft description

**Keep a month of history in the object and the rest in R2**

On the free plan, one Durable Object holds 1 GB. A busy owner adds about 10 KB of journal and messages per run, so the object fills in about a month. R2 gives 10 GB free.

This PR moves room history older than 30 days to R2, as gzip JSONL with one file per room per day. Scrolling back past the hot range loads those days, and search falls back to them. Installs without R2 keep everything in the object, and settings shows a warning at 800 MB.

## Steps

1. **Wire in experiment B's archive module** (`owner/archive.ts`).
2. **After a run,** archive at most one day per room. Write the file to R2, then delete those rows in the same step. Make it idempotent, because the R2 key is the room and the day.
3. **Room log.** A page request past the oldest hot message loads the archived days.
4. **Search.** When hot results run out, scan archived days, newest first, with a time budget.
5. **Settings.** Show object storage use, and the warning when R2 is absent.

## Gate

- Over a simulated 90 days at the target load, object storage stays flat after day 30.
- Scrolling back and searching both work across the hot/archive boundary.
- At most 1 R2 write per room per day.

## Out of scope

None. This is the last PR.
