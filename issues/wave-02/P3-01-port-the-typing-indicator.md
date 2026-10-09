# P3-01 Port the typing indicator

| Field | Value |
| --- | --- |
| Phase | 3 (`docs/phases/03-chat-features.md`) |
| Wave | 2 |
| Depends on | P2-01 |
| Difficulty | 3 of 5 |
| Area | frontend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p3-01-port-the-typing-indicator` |

## Verification

`bun test apps/web-solid/src/chat/typing` passes the presence state machine cases, and the `verify-yuki` typing feature shows the wave, the label change from one name to two, and the send shrink.

## Task

**Goal.** Port the reference component to Solid with the same behavior and no React.

**Read first.** `docs/reference/typing-indicator.react.tsx`. Architecture section 19.5.

**Files.** Create `apps/web-solid/src/chat/typing/create-typing-presence.ts`, `typing/TypingIndicator.tsx`, `typing/typing.css`, and tests.

**Build.**

- Port `useTypingPresence` as `createTypingPresence` with `ping`, `send`, `clear`, and `reset`, the 3000 ms timeout, the 900 ms minimum, the beat counter, and the 340 ms send phase.
- Port `describe` exactly, including "and 2 others".
- Drive the three dots with one CSS keyframe animation of 1.25 s and a delay of one third of the period per dot. Scale runs 0.74 to 1 and opacity 0.32 to 1.
- Precompute the two springs as CSS `linear()` easings and animate enter, exit, and send with the Web Animations API from the bottom-left origin.
- Update the `role="status"` text 700 ms after the label changes. Under reduced motion, show static dots and fade only.

**Done when.** Unit tests cover timeout, minimum visible time, send while typing, and a ping during the send phase.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/03-chat-features.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
