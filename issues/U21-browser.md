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
