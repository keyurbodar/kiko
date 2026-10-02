# P7-01 Build the trust extension

| Field | Value |
| --- | --- |
| Phase | 7 (`docs/phases/07-integrations-and-trust.md`) |
| Wave | 7 |
| Depends on | P1-12 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `kiko/p7-01-build-the-trust-extension` |

## Verification

`bun kiko verify injection --no-model` passes. Each canned attack runs through fake tools and the suite asserts that no tool with the `external` effect ran without an approval record.

## Task

**Goal.** Limit what an injected instruction can do, in code.

**Read first.** Architecture section 16.

**Files.** Create `apps/server/src/agent/extensions/trust.ts`, `apps/server/src/agent/effects.ts`, and `apps/cli/src/verify/suites/injection.ts`. Edit `factory.ts`.

**Build.**

- Make every kiko tool declare one effect: `read`, `write`, `message`, or `external`. A tool with no declared effect fails to register.
- In `afterTool`, wrap results from tools that return outside content in an `<untrusted>` block with a per-run nonce, escape look-alike tags, and mark the run tainted.
- In `beforeTool`, apply the table in section 16.3.
- Wrap agent envelopes in `<agent-message>` and submit them as user-role content. A tainted envelope starts a tainted run.
- Add the three-line rule to the base prompt.
- Assert in the factory test that every agent selects `Trust`.

**Done when.** The attack set has at least ten cases, including a look-alike closing tag, an instruction inside a tool result, and an agent message that claims to be the human.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/07-integrations-and-trust.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
