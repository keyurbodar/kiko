# P17-01 Kernel key and the user's browser

| Field | Value |
| --- | --- |
| Phase | 17 (`docs/phases/17-browser.md`) |
| Wave | 0 |
| Depends on | none |
| Difficulty | 3 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p17-01-kernel-key-and-the-user-s-browser` |

## Verification

`bun yuki verify kernel` passes with `KERNEL_API_KEY` set. A bad key is refused and nothing is stored. Two agents asking at once get the same browser, headless. A cookie set before the reaper deletes the browser is still there in the next browser, and still there after a switch to headful and back. The reaper deletes it after the warm window. Account wipe deletes it. At the end, Kernel's active list is empty. No frame sent to the client contains the key or a CDP URL.

## Task

**Goal.** A user pastes a Kernel key, and `UserDO` can lease the user's one browser to any of their agents, headless by default and headful on demand, with logins kept in the user's profile.

**Files.** `apps/server/src/integrations/kernel/`, `user/user-do.ts`, `packages/protocol/src/user.ts`, `schema.ts`, `apps/web-solid/src/settings/integrations.tsx`, `integrations-client.ts`, `apps/cli/src/commands/kernel.ts`, `apps/cli/src/verify/suites/kernel.ts`, `apps/server/test/kernel-lease.test.ts`, `docs/architecture.md`.

**Build.**

- `KernelStore` copies `ComposioStore`. It seals the key with AAD `kernel/key`, and the lease's CDP and live view URLs with `kernel/lease`.
- Measure the bundle with and without `@onkernel/sdk`. Keep the SDK only if it adds less than 50 KB gzipped. Record the number in section 26.
- `leaseBrowser(agentId)` creates once, with `headless: true`, `timeout_seconds: 600`, and the user's profile with `save_changes: true`. `switchMode(mode)` deletes the browser, then creates one in the other mode on the same profile, and returns the tabs' URLs to reopen. It returns the CDP URL. `releaseTabs(agentId)` stamps last use.
- The reaper, wipe, 401, 429, and 529 behave as in the tables above.
- Connecting checks the key with `GET /browsers?status=active`. Only a 200 stores it.
- A `KeyField` labeled "Kernel browser" below Composio, with the placeholder `sk_...`.
- Write architecture section 26 from this phase's decisions.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/17-browser.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
