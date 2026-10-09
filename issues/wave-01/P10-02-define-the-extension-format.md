# P10-02 Define the extension format

| Field | Value |
| --- | --- |
| Phase | 10 (`docs/phases/10-extensions.md`) |
| Wave | 1 |
| Depends on | P10-01 |
| Difficulty | 2 of 5 |
| Area | docs |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p10-02-define-the-extension-format` |

## Verification

`bun test` in `packages/protocol` passes `test/extensions.test.ts`, and a manifest with a bad name, a secret for a host outside `egress`, or a wrap of a safety section is refused with each problem named.

## Task

**Goal.** One manifest format, checked the same way on the server, in the CLI, and in the client.

**Files.** `packages/protocol/src/extensions.ts`, `user.ts`, `schema.ts`.

**Build.**

- The manifest mirrors pi-durable: `tools`, `sections`, `hooks`, `wraps`, plus `calls`, `egress`, `secrets`, `state`, `triggers`, `tests`.
- `checkManifest` and `checkBundle` return every problem as one plain line.
- `describeManifest` turns the manifest into the review lines the human reads.
- The user socket frames, events, and snapshot fields for extensions.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/10-extensions.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
