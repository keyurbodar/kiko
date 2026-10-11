# U27 One delivery path in RoomDO

**Model** Sonnet 5.5 medium. **Wave** 3. **Depends on** U07. **Port** 8827. **Timebox** 3 h.

## Findings (evidence in `issues/audit/room.json`)
1. The receive, refusal check, and mark step is copied four times with different refusal rules: `room/burst-flush.ts:99-107` (drops silently), `room/mail-drain.ts:138-149` (notifies), `room/room-do.ts:146-155` (drops), `room/wake-delivery.ts` `deliverWake` (refunds). Make one function with one refusal table. A refused human message gets a notice.
2. The daily turn is charged per attempt (`burst-flush.ts:71-73`, `user-do.ts:532-538`). Key it by burst id like `takeAutonomous`.
3. `mail-drain.ts:59` queues mail even when the send was not fresh. Queue only when fresh.
4. `reports.ts:89` stamps a held batch with a fresh `Date.now()` per attempt. Stamp once.
5. Burst memory capture is best effort with no retry (`burst-flush.ts:124`). Decide if loss matters; if yes, retry from a pending row.
6. `HeldWakes.due` ignores its time argument (`wake.ts:47-52`). Make the signature honest. One prune helper instead of three styles if it is shorter.

## Acceptance
One failing-first test per behavior change. `bun run --cwd apps/server test recipients limits initiative log-memory reactions` green. `bun yuki verify burst-backlog team-flow limits --url http://localhost:8827` green.

## Settled, do not change
`endRun` ordering stays. U05 showed every side effect is safe to repeat and moving `markEnded` first would lose work on failure (see `issues/U05-spike-agent.md`).

## Report

**Refusal table** (`room/receive.ts`, `receive()` is the only path; `introduce` in room-do.ts still calls `agent.receive` directly because it marks nothing and ignores the answer).

| Call site before | Full inbox | Other refusal (too_large) |
| --- | --- | --- |
| burst flush | whole burst retried | logged, marked delivered, dropped with no notice |
| mail drain | throws, alarm retries | logged, hop refunded, sender told |
| wake (room-do closure and deliverWake) | budget refunded, throws | budget refunded, marked seen, "refused" |

Now: `full` is one answer for everyone (nothing taken, nothing marked, the caller retries). A final refusal runs the sender's row of `REFUSED`: human gets a chat notice (id `refused:<envelope>:<slug>`, so a retry posts once), agent gets its hop refunded and a notice, system has no row and its caller refunds. An admitted envelope is marked delivered; a refused one is not, which also stops a refused human message from stamping the agent's chain.

**Other findings**
- Turn charge: `UserDO.takeTurn(id)` is keyed by burst id in `autonomous_taken` (no schema change). The `turn_taken` meta is deleted.
- Mail: queued only when `fresh`.
- Reports: a held batch uses its first signal's `at` as `openedAt`, so UserDO's `event:<openedAt>` fire id is stable across retries.
- Memory capture: left best effort. UserDO queues durably once the call lands; only a failed RPC loses it, and retrying needs a pending row plus an idempotent `hear`. Not worth it.
- `HeldWakes.due` renamed `next` (it never used a due time). Prune styles not unified: it would not be shorter.

**Failed before**: `user.test.ts` "a burst is charged one turn..." fails on old `takeTurn`; `room-receive.test.ts` "a send the room has seen before is not queued again" fails with `Expected length: 1 Received length: 2` when queueing is unconditional; "a held result batch keeps its opening time" fails with `Date.now()`. The refusal table tests have no old-code run (the module is new).

**Verified**: `bun run check` all 10 steps passed; `bun run --cwd apps/server test -- recipients limits initiative log-memory reactions room-receive user.test` 88 pass 0 fail; verify burst-backlog, team-flow, limits pass on :8827; check-rules and check-exports ok after merging main. Server on 8827 stopped.
