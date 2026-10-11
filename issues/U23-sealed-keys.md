# U23 One sealed-key store for Composio and Kernel

**Model** DeepSeek V4.1 Flash high. **Wave** 3. **Depends on** U07 (landed). **Timebox** 60 min.

## Goal
`apps/server/src/integrations/composio/store.ts` and `integrations/kernel/store.ts` each implement the same sealed key row, reseal rule, and generation counter. Two reseal rules can drift. Extract one small helper both call, only if the result is shorter overall. If it is not, leave them and say so.

## Acceptance
Net negative lines. `bun run --cwd apps/server test kernel composio credentials` green.

## Report

**Outcome: no code change.** The shared helper is not net negative, so I left both stores as they are, per the goal and standing order 7.

### What is actually shared

Only the sealed-key read path is duplicated:
- the sealed column shape `{ kek_version, iv, ciphertext }`;
- the conversion `{ kekVersion: row.kek_version, iv: new Uint8Array(row.iv), ciphertext: new Uint8Array(row.ciphertext) }` passed to `open`;
- the reseal rule `row.kek_version !== keyring.current.version`.

The write paths are not shareable. Composio's key row also carries the session JSON in `value` and reseals with a guarded `UPDATE ... WHERE name = 'key' AND kek_version = ? AND ciphertext = ?` so a session written meanwhile is not overwritten. Kernel's key row has no `value` and reseals by reusing its own `putKey`. A helper covering both writes would need a table name, an optional extra column and value, and two reseal strategies, which is longer than the code it replaces.

### Line counts (measured, then reverted)

Baseline on the branch: `composio/store.ts` 127 lines, `kernel/store.ts` 194 lines, total 321.

Attempt 1, helper as a new file `apps/server/src/integrations/sealed.ts` (10 lines: `SealedRow` and `openSealed`) with both stores calling `openSealed`:
- `composio/store.ts` 128 (+1: adds one import line, removes none)
- `kernel/store.ts` 194 (0: drops the local `Sealed` type, adds one import line)
- helper 10

Total 332 vs 321 = **+11 lines**.

Attempt 2, the same helper inside `core/durable/src/crypto.ts` so no store gains an import line:
- `crypto.ts` +9
- `composio/store.ts` 0
- `kernel/store.ts` -1

Total **+8 lines**. Dropping the helper's doc lines still leaves it positive.

Both attempts add lines. The deduplicated read logic is a handful of lines; the helper that carries it costs more than it saves. I also rejected a `SealedKey` class: it would still need the per-store generation counter and the guarded Composio reseal, so only Kernel could use it and it would be dead weight in Composio.

No test was added because there is no behavior change.

### Verification
- `bun run check`: all 10 gating steps passed (typecheck, lint, check-imports, check-rules, check-exports, and every package test). Frontend lint is advisory and non-gating.
- `bun run --cwd apps/server test kernel composio credentials`: 0 pass, 0 fail, 6 cached across 6 files (fresh from the same `bun run check` run, which reported `pass test apps/server`).
