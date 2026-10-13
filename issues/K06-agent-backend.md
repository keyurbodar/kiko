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
