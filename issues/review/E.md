# Review E: extensions, sandbox, files, browser

Reviewer: Claude Haiku 5.5 high, read-only, 2026-10-12. Probes in /tmp, deleted.

- **E1 high.** `core/durable/src/html-text.ts:36,66` (and `titleOf`): `toLowerCase()` changes length for `İ`, so text after `<script>` is cut: `htmlToText("İ<script>x</script>visible")` gives `"İ isible"`. Lower ASCII only.
- **E2 blocker.** `apps/server/src/files/bash.ts:377-400` commits spaces in order; `mv /c.txt /home/m.txt` commits the chat removal even when the home write is refused, so the file is lost. Fix: commit every space's writes first, deletions only when every write saved. Probe recipe: as `bash.test.ts:297`, ada runs `echo keep > /c.txt` then `mv /c.txt /home/m.txt; sleep 1` while bo writes `/home/m.txt`.
- **E3 high.** `apps/server/src/agent/browser/connection.ts:156-164`: a tab opened while `switchTo` runs lands in no map, so the cap is exceeded and idle never closes it. Register it in `parked` when `this.current !== held`. Remove the UNVERIFIED label at `docs/architecture.md:1733`.
- **E4 medium.** `apps/server/src/user/recurrence.ts:147` `repeatProblem` checks only the first gap; `FREQ=HOURLY;BYMINUTE=0,50` passes. Take the minimum gap over a period.
- **E5 medium.** `apps/server/src/user/extensions.ts:273-296` `scheduleTriggers` reads `enabled` before an await; quick toggles create triggers for a disabled extension. Serialize and re-read.
- **E6 medium.** `core/sandbox/src/check.ts:73-91` fake fetch checks only the host; runtime also requires `https:`, methods, headers, body. One pure `guestRequestProblem(manifest, request)` in `core/sandbox` used by both.
- **E7 medium.** The trigger rule has three homes (regex in `manifest.ts`, injected `repeatProblem` via `CheckOptions`, two closures); the wire schema calls `checkBundle` without options. Move the pure rule into `core/sandbox`.
- **E8 medium.** `apps/server/src/files/room-fs.ts:616-634,691-705` two-step commits are dead after U22; refuse batches that span backends.
- **E9 medium.** `apps/server/src/agent/browser/lease.ts` declares eleven methods twice (`LeasePort`, `UserBrowserRpc`, `userLease`). Keep one.
- **E10 medium.** `core/browser/src/cdp/session.ts:88` opens the Kernel CDP WebSocket from AgentDO, outside `egress`. Decide: route through egress, or document the exception.

Verdict: not approved. Most valuable: E2.
