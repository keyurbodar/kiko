# P17-01 Kernel key in Settings

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 2 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p17-01-kernel-key-in-settings` |

## Verification

`bun yuki verify kernel-key` passes with `KERNEL_API_KEY` set. A bad key is refused and nothing is stored. A good key is stored, the reply says connected, and the key never appears in any frame sent to the client. Disconnect clears it.

## Task

**Goal.** A user can paste a Kernel key in Settings, Integrations, and Yuki checks it and keeps it sealed.

**Files.** `apps/server/src/integrations/kernel/store.ts`, `kernel/client.ts`, `user/user-do.ts`, `packages/protocol/src/user.ts`, `schema.ts`, `apps/web-solid/src/settings/integrations.tsx`, `integrations-client.ts`, `apps/cli/src/commands/kernel.ts`, `apps/cli/src/verify/suites/kernel-key.ts`, `docs/architecture.md`.

**Build.**

- `KernelStore` copies `ComposioStore`. A `kernel` table, the key sealed with AAD `kernel/key`, re-seal on a new KEK, and a generation counter so a late write after clear is dropped.
- `client.ts` is the fetch client for `https://api.onkernel.com` with `Authorization: Bearer`. It has create, execute, screenshot, delete, and list. 429 and 529 return a typed busy error with `Retry-After`.
- Connecting checks the key with `GET /browsers?status=active`. Only a 200 stores it.
- Frames `connectKernel` and `disconnectKernel`, and status in the integrations listing. The reply has status only.
- A `KeyField` below Composio with the placeholder `sk_...` and the label "Kernel browser".
- Write architecture section 26 from this phase's decisions.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
