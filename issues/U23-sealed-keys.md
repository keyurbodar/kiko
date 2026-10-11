# U23 One sealed-key store for Composio and Kernel

**Model** Haiku 5.5 medium. **Wave** 2. **Depends on** U07. **Timebox** 60 min.

## Goal
`apps/server/src/integrations/composio/store.ts` and `integrations/kernel/store.ts` each implement the same sealed key row, reseal rule, and generation counter. Two reseal rules can drift. Extract one small helper both call, only if the result is shorter overall. If it is not, leave them and say so.

## Acceptance
Net negative lines. `bun run --cwd apps/server test kernel composio credentials` green.
