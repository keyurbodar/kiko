# Backend to S+ program

The goal is a backend where every area does its job with no known defect, every AGENTS.md rule is checked by a script, and nothing is redesigned that already works. The audit behind it is in `issues/audit/` (one JSON per area, all findings with `file:line` evidence).

## How this runs

- One coordinator (the chat that owns this file) writes `PLAN.md`, `ledger.tsv`, and `decisions.tsv`. Nobody else writes them.
- Each unit is one issue file `Uxx-*.md` and one branch `s/uxx-*` in its own worktree under `.claude/worktrees/<unit>`, made by `issues/bin/wt.sh`. A worker writes only its scope and its own issue file (a `Report` and a `Discoveries` section).
- Workers follow `issues/STANDING.md`. They commit on their branch and stop. The coordinator lands a branch on `main` with a no-fast-forward merge after reading the diff and the report. A conflict becomes a fix task, never a coordinator edit.
- After each landing the coordinator runs `bun run check` on `main` in the background (once U02 lands). A red `main` stops further landings until fixed.

## The real constraint

The machine has 4 CPUs and 15 GB of RAM. Every server test file boots its own workerd, and verify suites need a `wrangler dev` each. More than about 8 writing workers at once makes every worker slower, so the window is 8 writers plus read-only agents. There is no git remote, so "PR" means a local branch landed on `main`.

## Waves

| Wave | Units | Runs when | Why grouped |
| --- | --- | --- | --- |
| 1 | U01 U02 U03 U04 U05 U10 U11 U12 U20 U21 U22 U25 U30 | now | disjoint files; nothing waits on anything |
| 2 | U07 U29 U23 | after U01 lands (U29 also after U03) | they edit the Durable Object shells U01 trims |
| 3 | U26 U27 U28 | after U07 (U28 after U05's report, U27 after U05 question 3) | schema changes and DO behavior on the squashed base |
| 4 | U40 | after waves 1 to 3 | real-model proof on the finished code |
| 5 | U41 | last | enforce every rule, docs match code |

Gate `G01` (deploy to measure Free-plan budgets) waits for the operator. Nothing depends on it.

## Integration order

Land in this order when several are ready: U02 and U03 first (they make every later check cheaper), then U01, then the rest of wave 1 as they verify, then U07, U29, U23, then wave 3, then U40, then U41.

## Dependencies

- U07, U23, U26, U27, U28, U29 need U01 on `main`.
- U26, U27, U23 need U07 on `main`.
- U29 needs U03 (it flips the dev-guard rule).
- U28 and U27 consume U05's report.
- U41 needs everything.

## Dropped or parked, with reasons

- Dropping the `always` capture mode. It is a user setting; removing it changes product behavior with no evidence of harm.
- Paging the reset snapshot, lazy bash directory listing, a stored upload byte counter. No measurement shows a cost. Parked until G01 or a real report.
- The 20-run redelivery window in routines. Redelivery past 20 runs is not a real case.
- Effect wrapper around the CDP WebSocket, the wiring classes, the 107-method UserDO, the browser deciders and tool count. Correct and tested; changing them is style.
- Another redesign of RoomDO, UserDO, or AgentDO. They converged after about 90 commits each.
- One judge call per burst for facts and loops together. U25 batches capture; merging the two judges is a bigger change with unproven value.
