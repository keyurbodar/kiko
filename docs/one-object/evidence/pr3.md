# PR 3 clock evidence

The gate is zero alarms and rows over a simulated idle day, one alarm and 35 runs for routines due together, exact delivery with no browser, and passing routine and reminder suites. Measurements below must come from the real clock and scheduled tasks, plus the running Worker suites.

| Decision | Reason | Evidence | Result |
|---|---|---|---|
| Start from current PR2 | PR5 and PR2 build in parallel | Initial PR2 head contained only the socket commit | Owner clock and independent lanes can proceed; object wiring waits for committed skeleton |
| Serialize alarm replacement | Concurrent task settlement must not replace an earlier deadline from stale state | Earendil session.ts refreshAlarm and serializeAlarmUpdate | Clock reads its snapshot inside the serialized update |
| Preserve the first recovery deadline | Repeated refreshes must not postpone recovery | PR1 host.ts recovery behavior | Stable unfinished tasks skip duplicate alarm writes |
| Reserve archiveHistory after runs | PR6 archives once per room per UTC day without scheduling | Owner directive in PR3 session | Optional callback in after-run integration |
