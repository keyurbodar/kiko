# U21 Browser tab cap holds under parallel calls

**Model** Sonnet 5.5 medium. **Wave** 1. **Depends on** nothing. **Timebox** 2 h.

## Goal
Eight tabs means eight tabs, even when the model calls browse in parallel. Fewer layers to read.

## Findings (evidence in `issues/audit/files.json`)
1. `apps/server/src/agent/browser/connection.ts` `room()` awaits `lease.state()` before counting tabs, and `borrow()` and `openHeld()` register a tab only after `openTab` resolves, so two parallel calls both pass the cap. `browser-connection.test.ts` only tests a sequential ninth tab. Reserve before the first await, release on failure.
2. `apps/server/src/agent/browser/lease.ts` (`LeasePort`) is a port layer that mostly exists to be mocked. Fold it into `connection.ts` only if the result is smaller and the tests stay just as able to fake the lease. If folding makes testing worse, leave it and say why.
3. `core/browser/src/cdp/browser.ts:33` dismisses a dialog with `setTimeout`. Expire the dialog hold on the next browser call instead, or show why the timer is safe.

## Scope
`apps/server/src/agent/browser/*`, `core/browser/src/cdp/browser.ts`, `apps/server/test/browser-connection.test.ts`, `browser-tools.test.ts`, `core/browser/test/*`.

## Acceptance
A concurrent-borrow test that fails today. `bun run --cwd apps/server test browser` and `bun run --cwd core/browser test` green.

## Report

**Status:** done. Findings 1 and 3 fixed with tests. Finding 2 left, with reason below.

**Finding 1, tab cap under parallel calls.** Failed first, as the brief requires:

```
error: expect(received).toBeInstanceOf(expected)
(fail) browser connection > parallel borrows cannot both pass the tab cap
error: expect(received).toHaveLength(expected)
(fail) browser connection > parallel single tabs admit exactly the cap
3 pass, 2 fail across 1 files
```

The fix is in `connection.ts`. `room()` became `slots(extra, open)`. It reads the lease state, checks the cap, and holds the slots in one step, then runs `open()`. `opening` counts slots that are in flight but not yet in a tab map. The hold ends in `finally`, so a failed open releases its slots. Each registration (`held.tab`, `parked.set`, `borrowed.set`) now happens inside `open()`, before the hold ends. A gap between the two would let a parallel call through.

**Finding 2, `LeasePort` fold: left in place.** The interface is 17 lines and `userLease()` is real logic. It binds the agent and room ids and maps the not-connected error. Folding moves that adapter into `connection.ts` and does not delete it. The connection tests would then fake a 11-method RPC keyed by agent id, not a 9-method port. The brief says to leave it when testing gets harder.

**Finding 3, dialog timer.** Failed first on the old code:

```
error: expect(received).toBeNull()
(fail) an unanswered confirm is dismissed by the next call once the hold has passed
 12 pass
 1 fail
```

The 30 s `setTimeout` is gone. The dialog records when it was held. Each tab call (`read`, `act`, `eval`, `extract`, `screenshot`, `dialog`, `answerDialog`) first runs `settle()`. It dismisses the dialog if the hold has passed. `connect()` takes a `now` option, defaulting to `Date.now`, so the test can move the clock.

**Verified (commands and result lines):**

- `bun run --cwd apps/server test -- browser` gave `19 pass, 0 fail across 3 files`.
- `bun run --cwd core/browser test` gave `71 pass, 0 fail`, `Ran 71 tests across 5 files`.
- `bunx biome check` on the six touched files gave `Checked 6 files in 128ms. No fixes applied.`
- `bun run typecheck` exited 0 for all ten packages.
- `bun scripts/check-imports.ts` gave `imports ok: durable, browser, agent, memory, sandbox, protocol`.

**Not run:** `bun yuki verify browser`. It needs a live dev server and a Kernel key. Dialog timing changed, so a live run would be worth doing before this lands.

## Discoveries

- **Cross-agent race remains.** `slots()` reads `lease.state()` and counts other agents' tabs from that read. Another agent's opens in flight are not visible until it touches the lease after opening. Two agents on one browser can still pass the cap together. Closing it needs a reservation in the UserDO lease. That is outside this unit.
- **Possible orphan tab on `switchTo` during an open.** UNVERIFIED. If `switchTo()` runs while `openHeld()` is in flight, `held.tab` is set on a held that is no longer `current`. The tab is then in no map, so it is not counted and `idle()` does not close it. Found by reading the code, not reproduced.
