# U07 One current schema per object

**Model** Haiku 5.5 medium. **Wave** 2. **Depends on** U01 landed. **Blocks** U26, U27. **Timebox** 2 h.

## Goal
Every table is created once in its current shape. One migration mechanism remains for the future.

## Context
Nothing is deployed: Cloudflare reports no `kiko` Worker on the signed-in account (decision D-squash in `issues/decisions.tsv`). Local `.wrangler` dev state may be discarded. About 57 migration sites in 12 files: `apps/server/src/room/schema.ts`, `room/mail.ts` (PRAGMA ALTERs), `room/asks.ts`, `room/signals.ts` (DROP TABLE every boot), `user/schema.ts` (executor_secrets drop, unused `limits` table), `user/reminders.ts`, `user/import-records.ts`, `core/memory/src/life.ts` (NORM_VERSION rewrite), `core/memory/src/optmem.ts` (tainted column), and the Composio pre-session shim in `apps/server/src/integrations/composio/store.ts:21-22`.

## Build
Fold each ALTER, DROP, and rewrite into the table's CREATE. Keep exactly one mechanism (the versioned list in each object's schema module, starting from version 1) for future changes. Delete `import-records.ts` and its call. Do not touch tables that `pi-durable` owns. Do not touch `core/agent/src/*` (U28 edits it in parallel; its few migration lines stay for now).

## Acceptance
Fresh objects have the same final columns as before (prove it: dump `PRAGMA table_info` for every table from a test object before and after, diff equal). All server tests green (use `bun run check` if U02 has landed). `bun yuki verify --no-model` green on your port 8807.
