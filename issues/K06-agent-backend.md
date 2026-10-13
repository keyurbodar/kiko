# K06 typed agent activity, system events, ask_human, skills route

GOAL: the wire carries what the new UI needs: typed activity per agent, worker state, typed system events, a human question tool, and a skills list.

CONTEXT: `refs/reports/R5-agent-surfaces.md` (backend gaps 1 to 3 and units), `refs/reports/R2-chat-messages.md` section 3.7 and unit D steps 2 to 3, `refs/reports/R8-frontend-audit.md` section 1.3 item 1. `issues/REDESIGN.md` items 6, 7, 10. Protocol changes are append-only schema steps with an unknown-kind-is-ignored rule. No approval gate (do not build one).

SCOPE: `core/protocol/**`, `apps/server/src/room/**`, `apps/server/src/agent/**`, `core/agent/**` (workers), `apps/server/src/skills/**` and a skills list route, `apps/cli/**` verify suites, `docs/architecture.md`. No client code except `core/protocol` fixtures.

ACCEPTANCE:
- `status` frames carry a typed `activity` (writing, tool with kind, waiting on an agent, failed, background with worker list); room snapshots include per-agent state so a reconnect shows it; `ask` to a teammate yields a visible waiting state.
- `SystemEvent` union (delegated, subagent with private true, routine, agent_message, activity) on system messages; a private subagent event reaches only the owner socket (server test that fails if it leaks).
- `ask_human` tool with a stored event, answer and skip frames; effect declared.
- Skills list route returns built-ins.
- Every protocol fixture round-trips; an unknown event kind decodes without throwing.
- Add or extend one verify suite in `apps/cli` covering activity frames and ask_human; run it against your own dev server with the real model keys and show the output.

VERIFY: typecheck, selected server tests via heavy.sh, the verify suite on your own port, check-rules and check-exports.

## Report

STATUS: partial

QUESTION: The client typecheck fails in three files that this branch breaks. The protocol now has `answer` and `skip` client frames, and `describeCall` returns an object, not a string. Fixing them is client work, outside K06's scope. Recommendation: allow three small edits in `apps/web-solid`. (1) `src/sync/mock-room.ts`: add `answer() {}` and `skip() {}` handlers. (2) `src/sync/patches.ts`: add `answer` and `skip` entries to `roomConfirms`. (3) `src/chat/typing/action.test.ts`: use `describeCall(name, args)?.doing` in place of the bare call. Until this is decided, `bun run typecheck` and `bun run check` fail.

BRANCH: s/k06-agent

HEAD: 817ebb60 at the time of the report commit (the final HEAD SHA is in the handoff)

CHANGED:
- apps/cli/src/verify/suites/agent-activity.ts: wait for the lead's idle frame, not two idle frames.
- apps/server/src/room/room-do.ts: construct `HumanAsks` in the constructor.
- apps/server/test/private-events.test.ts: assert the worker's full title, not a substring of the human's own message.
- apps/server/test/room-activity-worker.ts and room-activity.test.ts: test helper fixes for the first frame and rpc calls.
- apps/server/test/skills-route.test.ts: new, covers the skills route.
- apps/server/src/agent/extensions/presence.ts, room/human-asks.ts: unexport helpers used only in their file.
- core/protocol/src/fixtures.ts, room.ts, user.ts: unexport helpers used only in their file.
- merge commit f6e0cb14: `main` merged in cleanly, no conflicts.

VERIFIED:
- `git merge main`: clean merge, 48 files, no conflicts.
- `bun install` in the worktree: "2 packages installed [342.00ms]". Needed after the merge.
- `bun run typecheck`: exit 2. Server, cli, protocol and every package pass. Three web-solid errors, see QUESTION.
- `bun run --cwd core/protocol test`: "118 pass, 0 fail, 384 expect() calls, Ran 118 tests across 7 files".
- `bun run --cwd apps/server test -- room-activity private-events skills-route`: "14 pass, 0 fail across 3 files" (private-events 4, room-activity 7, skills-route 3).
- `bun kiko verify agent-activity --url http://localhost:5306` (own dev server, real model keys loaded from the shell): "pass agent-activity (42034ms)". Steps: typed tool status, reconnect snapshot, waiting on a teammate, worker activity, worker line not in search, ask_human answer, ask_human skip, real model asked and replied, real model tool calls typed.
- `bun scripts/check-rules.ts`: "check-rules ok in 98 ms".
- `bun scripts/check-exports.ts`: "check-exports ok: 210 files, 185 baselined". Before the unexport fix it failed with 8 new unused exports.
- `bun scripts/check-imports.ts`: "imports ok: durable, browser, agent, memory, sandbox, protocol, theme, avatar".
- `bunx biome check apps/server core apps/cli scripts`: exit 0, 11 warnings, no errors.
- Dev server on port 5306: killed after the suite. `ps` showed no remaining 5306 process.
- `git status --short`: empty after the final wip commit.

ACCEPTANCE:
- Status frames carry typed `activity`; snapshot per-agent state; waiting on a teammate: covered by room-activity tests and the suite steps above.
- SystemEvent union with private subagent: private-events test passes. It asserts no leak to memory, search or chat preview.
- ask_human with stored event, answer and skip frames, effect `message`: suite steps pass, and the tool declares `declareEffect("message", ...)`.
- Skills list route returns built-ins: skills-route test passes.
- Protocol fixtures round trip and unknown event kind decodes: round-trip tests pass (118).
- One verify suite extended and run against own server: agent-activity, pass.

FAILED-BEFORE: Not reproduced in this run. The suite failure from the previous run ("both agents to go idle", a poll that needed two idle frames) is fixed by waiting for the lead's idle frame, and the new suite passes. I did not run the old code to show the failure line, so this item is not proven here.

DEVIATIONS:
- The private-events assertion was weakened from "pricing pages" to the worker's full title. The human message "find the pricing pages" contains that substring, so the old assertion failed for a reason unrelated to a leak.
- Eight exports were made module-private to satisfy check-exports.
- `bun install` was run in the worktree after the merge.

FOLLOW-UPS:
- The three web-solid errors (see QUESTION).
- `scripts/exports-baseline.txt` has one stale entry. check-exports reports it as used or gone. It is outside K06's scope.
- Biome warnings in this branch: `apps/server/src/room/room-do.ts` lines 410 and 427 (useOptionalChain), `core/protocol/src/fixtures.ts` lines 145 and 146 (noNonNullAssertion).
