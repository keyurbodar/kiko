# U32 Fold core/agent migrations into their CREATEs

**Model** Haiku 5.5 medium. **Wave** 2. **Depends on** U28 landed (it has). **Timebox** 60 min.

## Goal
Finish U07's squash for `core/agent`, which U07 left alone while U28 edited it. Nothing is deployed, so local dev state may be discarded.

## Sites (from U07's report)
- `core/agent/src/inbox.ts:51-57`: ALTERs on the inbox table.
- `core/agent/src/workers.ts:91-92`: an ALTER.
- `core/agent/src/host.ts:160`: a DROP that runs on every boot. Find what it drops and why before removing it.

## Build
Fold each ALTER into its CREATE. Remove one-shot drops and rewrites. Do not touch any table `pi-durable` owns. Prove columns are unchanged: dump `PRAGMA table_info` for each core/agent table from a fresh object before and after (the existing `apps/server/test/hardening*.ts` or `workers*.ts` harness can host it), and show the diff is empty.

## Scope
`core/agent/src/{inbox,workers,host}.ts`, a column-proof test in `apps/server/test`.

## Acceptance
`bun run check` passes. The column proof shows no change.
