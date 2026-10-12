# Review B: agent runtime

Reviewer: Claude Haiku 5.5 high, read-only, 2026-10-12. U51 reviewed at c0e04ddb (mid round 2).

- **B01 high (U51).** Only bash reports saved paths; other file tools map paths from arguments, wrong for folder destinations (`mv a.txt docs/` records `/a.txt, /docs`). `work-tools.test.ts:280-282` pins the wrong answer. Fix: each file tool reports the paths `RoomFs` actually wrote through the same `details` channel bash uses; delete `TOUCHED`, `touchedPaths`, casts, and the `Object.create(files, ...)` wrapper. UNVERIFIED that `details` stays out of model content.
- **B02 high (U51).** List not capped at 20 plus a count as the brief said; `touched` rewrites the JSON each time (O(N²)).
- **B03 blocker (U51).** `apps/cli/src/verify/suites/workers.ts:76` asserts `w1 (running)` but `note()` now prints `w1 (running, N steps)`.
- **B04 high (U51).** New columns only in `CREATE TABLE IF NOT EXISTS workers`; an existing table lacks them and `JSON.parse(undefined)` throws in `toWork`. Label the reset as ASSUMPTION or guard it.
- **B05 medium (U51).** Architecture §8 and U51.md are stale.
- **B06 medium.** `core/agent/src/host.ts:307-311,358-360` abort goes out after `root.submit` and `inbox.submitted`; a crash between leaves no abort. Issue the abort before submit.
- **B07 medium.** `agent-do.ts:130-134` interrupts asks before admission (A9).
- **B08 medium.** Stoppability in three places (effect, `STOPPABLE_TOOLS`, `interruptible` callback); the `!interruptible` guard is dead; `ask` on the list adds nothing on the human path; two false comments (`factory.ts:57-58`, `host.ts:111`); `stoppable.test.ts` uses a hand-built map. Fix: declare stoppable on the tool, delete the list and the option, drop `ask`.
- **B09 medium.** `stoppableTools` reads entries for every running tool serially; record `callId -> name` from `tool_execution_start` in the outbox instead.
- **B10 medium.** Two wipe-guard idioms in `agent-do.ts`; `setModel` unguarded; `this.effects` assigned in two branches.
- **B11 high (U54 evidence).** Strict count is 4 of 6, not 5 of 6; the prompt line is keyed on "how is it going?" while the spike sends "what is the status?"; case 10 never asked while a worker ran (`runningAtSend` 0 in all six). Rerun with the question sent only after a worker is running, count strictly.

Verdict: not approved. Most valuable: B01.
