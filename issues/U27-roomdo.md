# U27 One delivery path in RoomDO

**Model** Sonnet 5.5 medium. **Wave** 3. **Depends on** U07, U05 report (question 3). **Port** 8827. **Timebox** 3 h.

## Findings (evidence in `issues/audit/room.json`)
1. The receive, refusal check, and mark step is copied four times with different refusal rules: `room/burst-flush.ts:99-107` (drops silently), `room/mail-drain.ts:138-149` (notifies), `room/room-do.ts:146-155` (drops), `room/wake-delivery.ts` `deliverWake` (refunds). Make one function with one refusal table. A refused human message gets a notice.
2. The daily turn is charged per attempt (`burst-flush.ts:71-73`, `user-do.ts:532-538`). Key it by burst id like `takeAutonomous`.
3. `mail-drain.ts:59` queues mail even when the send was not fresh. Queue only when fresh.
4. `reports.ts:89` stamps a held batch with a fresh `Date.now()` per attempt. Stamp once.
5. Burst memory capture is best effort with no retry (`burst-flush.ts:124`). Decide if loss matters; if yes, retry from a pending row.
6. `endRun` marks the run ended after side effects (`room-do.ts:860-875`). Apply the U05 answer.
7. `HeldWakes.due` ignores its time argument (`wake.ts:47-52`). Make the signature honest. One prune helper instead of three styles if it is shorter.

## Acceptance
One failing-first test per behavior change. `bun run --cwd apps/server test recipients limits initiative log-memory reactions` green. `bun yuki verify burst-backlog team-flow limits --url http://localhost:8827` green.
