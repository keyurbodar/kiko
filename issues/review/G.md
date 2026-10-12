# Review G: tests and suites

Reviewer: DeepSeek V4.1 Flash high, read-only, 2026-10-12.

- **G01 high.** `apps/server/test/reminders.test.ts:135-141` never checks that deleting a chat drops its webhook lookup rows (`routines-wiring.ts:47-49,104-106`); the test worker has no `AUTH_DB`, so `dropHook` throws and `waitUntil(...).catch` swallows it (`user-do.ts:918`). Add the test in `routines-hooks.test.ts` with `timedRoutines()` and `hookRows()`.
- **G02 high.** `room-receive.test.ts:71-79` asserts `deliveries("r1") === 0` but nothing charged `r1`; unfalsifiable. Charge first, then refuse, assert the refund.
- **G03 medium.** `room/reports.ts:50` quote-to-`answers` extraction (U35's judge-free rule) has no test through that line; `initiative-runs.test.ts:109` injects `answers` by hand.
- **G04 medium.** `room-receive.test.ts:35` fake admits the second receive, so the refusal notice dedup id (`receive.ts:33`, `deliver.ts:76-83`) is never tested.
- **G05 medium.** `agent-columns.test.ts` plus a `columns` op in `workers-worker.ts` duplicate the `schema-worker.ts` plus JSON fixture mechanism. Merge into one fixture; ~70 lines deleted.
- **G06 medium.** U28's `AgentDO` interrupt wiring (`agent-do.ts:91`) has no test under `bun run check`; `interruptible: () => false` keeps every unit test green.
- **G07 medium.** `apps/cli/src/verify/suites/mid-run.ts:98,103` asserts pi-durable's abort sentence, not behavior.

Verdict: approve with reservations. Most valuable: G01.
