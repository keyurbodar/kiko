# P10-03 Build the sandbox and the compiler

| Field | Value |
| --- | --- |
| Phase | 10 (`docs/phases/10-extensions.md`) |
| Wave | 8 |
| Depends on | P10-02, P7-01, P1-10 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p10-03-build-the-sandbox-and-the-compiler` |

## Verification

`bun run --cwd apps/server test script-vm user-extensions` passes: an infinite loop is stopped, a fetch taints the run so trust blocks the next external call, a read tool cannot fetch or call a write tool, and trust is selected last.

## Task

**Goal.** A user extension becomes an ordinary pi-durable extension whose every call the manifest limits.

**Files.** `apps/server/src/agent/script/vm.ts`, `compile.ts`, `check.ts`, `wasm.ts`. Edit `agent/factory.ts`.

**Build.**

- One VM per extension version per agent process, with a CPU budget, a memory cap, and a wall deadline.
- `kiko.call`, `kiko.fetch`, `kiko.state`, `kiko.next`, `kiko.log`, each checked per call.
- `UserExtensions` in the factory: sync installs, removes, and reports clashes; the selection ends with trust.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/10-extensions.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
