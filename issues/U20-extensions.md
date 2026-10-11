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
