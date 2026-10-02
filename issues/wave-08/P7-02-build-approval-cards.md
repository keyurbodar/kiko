# P7-02 Build approval cards

| Field | Value |
| --- | --- |
| Phase | 7 (`docs/phases/07-integrations-and-trust.md`) |
| Wave | 8 |
| Depends on | P7-01, P2-08 |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p7-02-build-approval-cards` |

## Verification

`bun kiko verify approvals` passes with a fake `external` tool: a tainted run pauses, the room shows an approval, `approve` with `accept` runs the tool, `decline` returns an error to the model, and a second `approve` for the same id does nothing.

## Task

**Goal.** Let the human, and only the human, approve an outside action.

**Read first.** Architecture sections 9.2 and 16.3.

**Files.** Create `apps/server/src/room/approvals.ts` and `apps/web-solid/src/chat/ApprovalCard.tsx`. Edit `agent/extensions/trust.ts`.

**Build.**

- A `ws_approvals(id, run_id, tool, summary, state, expires_at)` table in the room.
- The gate asks the room for an approval and ends the tool call as pending. The decision returns as an `approval_result` envelope.
- Accept the `approve` frame only from a human socket.
- Render the card with the tool name, a plain summary of the arguments, and accept and decline buttons. Show an expired state.

**Done when.** No RPC method that an agent can call changes an approval's state.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/07-integrations-and-trust.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
