# K08 activity row, ask card, system events, tasks and workers surface

GOAL: the human always sees what each agent is doing and when they are needed, without the transcript filling with noise.

CONTEXT: `refs/reports/R5-agent-surfaces.md` (read it all), `refs/reports/R2-chat-messages.md` section 3.7, `issues/REDESIGN.md` items 6 and 7, the user's activity reference (a compact live row above the composer). Read t3code's real pieces in `refs/t3code/apps/web/src/components/chat`: ComposerPendingUserInputPanel.tsx, ThreadStatusIndicators.tsx, WorkLog.tsx, ProviderSubagentBar.tsx, and `packages/client-runtime/src/state/subagentDisplay.ts`. Port the ideas into Solid with Kobalte; no React, no Effect.

DEPENDS ON: K04, K05, K06 on main. The wire (typed `activity` on status frames, per-agent state in snapshots, `SystemEvent`, `ask` and `ask_resolved` events, `answer` and `skip` frames) is already in `core/protocol`. K06b made the client reducer store activity and keep system events out of the bubble list; build on that.

SCOPE: `apps/web-solid/src/chat/**` (typing, SystemMessage, info/tasks), `apps/web-solid/src/composer/**` for the floating cards and the Stop button, `apps/web-solid/src/lib/store.ts` and `sync/**` only to expose derived state. No server or protocol changes; if one is needed, stop and report.

ACCEPTANCE:
- A typed `ActivityModel` derived by one pure function from wire frames: idle, writing, tool (with kind and caption), waiting on an agent, failed, background with worker list. Table test for every case.
- Replace the typing-only indicator with a compact live row above the composer: one line per working agent (avatar from @kiko/avatar, caption, elapsed time written without re-rendering), counts instead of lists for many agents, a working Stop button that sends the stop frame (the stub at composer.tsx:182 is a bug; prove it stops a real run).
- Ask-the-human card floats over the composer, one at a time, options from the event, number keys pick, Skip, free-text; answer and skip apply optimistically and confirm on `ask_resolved`. No approval cards: Kiko has no approval gate.
- System events render as quiet, contextual separators (not bubbles): delegated, subagent (private), routine, agent message, activity. Agent-to-agent traffic folds into one expandable line. A private subagent event never shows text it should not.
- Right panel Tasks and Agents sections show tasks and workers with step text and status from real data.
- 0 ms animation except a status dot pulse that respects reduced motion.

VERIFY: typecheck, web-solid tests, check-imports, bundle budget numbers reported; real run in a browser with a real model and real keys: send a task that makes the lead start a worker and ask the human a question; screenshot the activity row, the ask card, a system separator and the tasks section, dark first then light, under `.verify-evidence/K08/`.
