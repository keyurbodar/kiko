# U23 One sealed-key store for Composio and Kernel

**Model** DeepSeek V4.1 Flash high. **Wave** 3. **Depends on** U07 (landed). **Timebox** 60 min.

## Goal
`apps/server/src/integrations/composio/store.ts` and `integrations/kernel/store.ts` each implement the same sealed key row, reseal rule, and generation counter. Two reseal rules can drift. Extract one small helper both call, only if the result is shorter overall. If it is not, leave them and say so.

## Acceptance
Net negative lines. `bun run --cwd apps/server test kernel composio credentials` green.
