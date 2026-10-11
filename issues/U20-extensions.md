# U20 Make the extension review tell the truth

**Model** Sonnet 5.5 medium. **Wave** 1. **Depends on** nothing. **Timebox** 2.5 h.

## Goal
What the human approves at install is exactly what the script can do, and the checker runs the same code as the runtime.

## Findings to fix (evidence in `issues/audit/sandbox.json`)
1. Read-effect tools can write `yuki.state` (`core/sandbox/src/compile.ts:155` passes readOnly=false). The review says read tools only read (`manifest.ts:293`). Refuse state writes from read tools.
2. The trigger rule says at most once an hour but only rejects `FREQ=MINUTELY` (`manifest.ts:240`), so `FREQ=HOURLY;BYMINUTE=0,10,20,30,40,50` passes `extension_check` while install refuses it (`apps/server/src/user/reminders.ts:16,621`). One rule for both, with an honest message.
3. `check.ts:74-111` reimplements the bridge and already differs (egress host lowercasing). Make `extension_check` compile with fake ports and call the real bridge, then delete the copy.
4. Prelude helpers (`host`, `hostSync`, `ask`, `makeYuki`, `pick`, `parse`, `vm.ts:17-21`) are visible to scripts. Wrap the prelude so only `__invoke` and `__shape` are reachable, and extend the escape test in `apps/server/test/script-vm.test.ts`.
5. `retain()` disposes a VM an in-flight call may still use (`compile.ts:79-85`). Mark it retired and let the call's finally dispose it.
6. Section keys collide (`compile.ts:217`). Always use `name:id`. Check what the key is used for (prompt section ordering in `pi-durable`) before changing the format.
7. Install sends its event after `scheduleTriggers`, so a trigger failure reports an error for an installed extension (`apps/server/src/user/extensions.ts:265-269`). Fix the order or record the error on the row.
8. Short secrets (under 6 chars) are not scrubbed from responses (`extensions.ts:448`). Scrub any non-empty secret.

## Scope
`core/sandbox/src/*`, `apps/server/src/user/extensions.ts`, `apps/server/test/script-vm.test.ts`, `user-extensions.test.ts`, `extension-store.test.ts`. Read `apps/server/src/agent/factory.ts` but do not edit it (U01 edits it).

## Acceptance
One test per finding that fails before the fix. `bun run --cwd apps/server test script-vm user-extensions extension-store` green.

## Report
All eight findings fixed, one test each (finding 6 shares a test with the section wiring).

1. `makeToolBridge` refuses `state.set` and `state.delete` from a read tool, with `a "read" tool can only read yuki.state`.
2. `checkBundle` and `checkManifest` take `{ repeatProblem }`. The server passes `repeatProblem` (moved to `user/recurrence.ts`, with `MIN_REPEAT_MS`) from `propose` and from `extension_check`, so `FREQ=HOURLY;BYMINUTE=0,10,...` is refused at both places. The MINUTELY message now says 30 minutes. `docs/architecture.md` line 1412 updated.
3. `check.ts` now builds its bridge with `makeToolBridge` and `makeQuietBridge` from `compile.ts` over fake ports. The hand-written mock is deleted.
4. The prelude is wrapped in an IIFE; only `__invoke` and `__shape` stay global.
5. `ScriptVM.retire()` marks the VM retired. A call in flight finishes and its finally block disposes it. `settle` keeps delivering because retired is not `broken`.
6. Section key is now `<extension>_<id>`. pi-durable's key regex is `^[a-z][a-z0-9_-]*$` (no colon), and it uses the key as the XML tag and as the map key across all extensions. `_` cannot appear in a name or id, so two extensions cannot collide, and a section can no longer take a built-in's key.
7. `install` emits the extension event before `scheduleTriggers`, and `cancelBy` failure is recorded on the row as `triggers: ...`.
8. Any non-empty secret is scrubbed.

Failed before: extension-store (short secret, trigger failure), script-vm (prelude helpers, retire), user-extensions (suite no longer loaded without `repeatProblem`).

## Discoveries
- `wraps.sections` on another extension's section key now needs the new `<ext>_<id>` key. Nothing in the repo does that.
