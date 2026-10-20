# One object: the PRs

This folder holds one file per PR. Each file is the brief for the session that builds the PR, and its top section is the draft PR description. The design behind all of them is in `../README.md`.

## Strategy

Kiko has one human per Worker, but the server runs four kinds of Durable Object, with one instance per room and one per agent. Every boundary between objects needs a billed call, a stored queue, an alarm to drain it, and a retry when it fails. On 2026-10-19, two idle agents looped on a failing alarm and used up the free plan's 100k rows for the day.

The redesign removes the boundaries instead of guarding them:

1. **One object.** `OwnerDO` holds every room, agent and worker. A delivery is a method call.
2. **One journal per agent.** pi-durable writes through `Storage.commit`, and Kiko stores each commit as one row. Streaming tokens are never stored.
3. **One alarm.** It is set to the earliest pi task deadline. It exists only while a run, a routine or a lease needs it.
4. **Failure is a message.** A failure becomes one error bubble. No code schedules work after an error.
5. **Use pi-durable instead of hand-built parts.** pi's inbox, scheduled tasks, task-owned conversations and conformance suite replace Kiko's own versions. Earendil's reference is <https://github.com/earendil-works/pi-durable-cloudflare>.

Where it ends up: a prompt goes from 136 rows to about 6 to 8. An idle day goes from about 600 rows to 0. A failure goes from about 58k rows a day to 1 row. About 6,000 lines are deleted.

## The PRs

| # | File | PR | Branch | Base | Status |
|---|---|---|---|---|---|
| 0 | [pr0-pin-pi.md](pr0-pin-pi.md) | Pin pi packages, add Dependabot | `deps/pin-pi` | `main` | in progress |
| 1 | [pr1-journal.md](pr1-journal.md) | Journal storage, no heartbeat | `one-object/pr1-journal` | `main` | done, not pushed; AgentDO 30 rows (87 before) |
| 2 | [pr2-owner-do.md](pr2-owner-do.md) | `OwnerDO`: one object, one socket | `one-object/pr2-owner-do` | PR 1 | not started |
| 3 | [pr3-clock.md](pr3-clock.md) | One clock; background work after runs | `one-object/pr3-clock` | PR 5 | not started |
| 4 | [pr4-schema.md](pr4-schema.md) | One schema | `one-object/pr4-schema` | PR 2 | not started |
| 5 | [pr5-runs.md](pr5-runs.md) | One invocation per run | `one-object/pr5-runs` | PR 2 | not started |
| 6 | [pr6-archive.md](pr6-archive.md) | R2 archive | `one-object/pr6-archive` | PR 4 | not started |
| — | [experiments.md](experiments.md) | Three experiments that run alongside PR 2 | none | — | not started |

## Order

```
PR 0 ─────────────────────────────────────────────▶ main
PR 1 ─────────────────────────────────────────────▶ main
        └─ PR 2 (+ experiments A, B, C running alongside)
               ├─ PR 4 ──┬─ PR 6
               └─ PR 5 ──┴─ PR 3
```

- PR 0 and PR 1 are independent, and both target `main`.
- PR 2 stacks on PR 1. When PR 1 merges, rebase PR 2 onto `main`.
- PR 4 and PR 5 run at the same time after PR 2, because they touch different files.
- PR 3 follows PR 5, because both decide how runs get scheduled.
- PR 6 follows PR 4, because it archives the final `messages` table.

## Rules for every PR

- One change is one PR. Anything outside the PR's scope goes in a later PR, or gets reported.
- Base on `origin/main`, or on the parent PR's branch. Never base on a stale local `main`.
- Read `AGENTS.md` and `../README.md` first.
- The orchestrator is Codex `gpt-6.1-sol` with medium reasoning. Children are routed by task size:

  | Task size | Provider | Model |
  |---|---|---|
  | Complex | `codex` | `gpt-6.1-sol`, medium |
  | Medium | `opencode` | `amr-link/deepseek-v4.1-flash` |
  | Small | `opencode` | `opencode-go/minimax-m3.1-flash-free` |
  | Narrow, specific | `acpRegistry_devin` | `claude-haiku-5-5-medium` |

- Measure the gate with the `journal-overhead` suite on your own dev server, on a free port. Stop only your own PID. Record the before and after numbers, measured on the base branch and on the PR.
- Tests must fail when the behavior breaks. Don't add exploratory tests or tests of a library's own behavior.
- Don't tune code that a later PR deletes.
- Commit messages say what changed and why. End each one with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. End each PR description with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Don't push or open a PR until the owner approves the report.
