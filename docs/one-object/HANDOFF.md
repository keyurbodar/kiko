# Handoff: the one-object redesign

Updated 2026-10-20. Read this file first, then `AGENTS.md`. `README.md` explains the design.

## The problem

Kiko installs hit the Cloudflare Free plan's cap of **100,000 rows written a day**, and then every write and socket fails until 00:00 UTC. That happened to the owner's install with almost no use.

- **Root cause:** an agent alarm that retried forever. The catch block in `core/agent/src/host.ts` kept its failure count in memory, so the count reset whenever Cloudflare evicted the object. Two idle agents wrote about 115k rows a day this way. The code had seven loops like it.
- **Underlying cause:** four Durable Object classes. One prompt made about 18 calls between objects and wrote 136 rows.
- **Every self-deployed install has this bug** until it runs this release.

## What shipped

All of it ships in one PR from branch `one-object/integrated` to `main`.

1. **One `OwnerDO`.** Rooms, agents, the user and files become classes inside one Durable Object named `owner`, sharing one SQLite database. There are no calls, queues or retries between objects. Each tab uses one socket.
2. **pi-durable is stored as a journal** (`core/agent/src/journal.ts`): one row per `Storage.commit`, replayed into `MemoryStorage` on open.
3. **One clock and no background timers.** Background work runs at the end of a run the human started.
4. **Failure is a message.** A failed run writes one error row and schedules nothing.
5. **A call budget per run.** A run started by a human message executes inside that socket event (`OwnerDO.humanInput`). Every run one event starts shares one 40-call budget (`Runs.budget()`). Routines, recovery, mail and continuations run from the alarm.
6. **Cold history in R2.**
7. **Writes cut from 59 to 33 per prompt.**
   - These were stored separately and are now queries over source rows: the unread count, the memory sync cursor, deadline projections, and the bubble outbox (its cursor now comes from the message rows).
   - Indexes that no hot read used are dropped.
   - A prompt no longer writes any KV keys.
   - An alarm already set to the same time isn't set again.
8. **No unit tests.** All 331 test files are deleted. The only check of behavior is the e2e `bun kiko verify journal-overhead`, which CI runs on every backend push. Its gate is the measured cost of 33, so a regression fails.
9. **Data is wiped.** There's no migration. Protocol 3 needs the installer's exact acknowledgement, `delete-existing-data`. New releases go to `latest-owner.json`; `latest.json` stays frozen for old installs.

## Before and after

From the one e2e with a fake model (`evidence/e2e-before.log` and `evidence/e2e-after.log`).

| | `main` v0.4.16 | This PR |
|---|---|---|
| Billed writes per prompt | 136 SQL rows, plus KV and alarms | **33** (30 SQL + 3 `setAlarm`) |
| Writes in the idle minute after a prompt, then after an error | 9, then 5 | **0, then 0** |
| A failing prompt | 248 rows + 6 alarms | **42 writes, 1 visible error row, then nothing** |
| Calls between objects per prompt | ~18 | **0** |
| Heavy day of 2,840 runs | ~386k rows, nearly 4× the cap | ~94k, just under the cap |

Checks run once on the final tree: typecheck, lint, imports, rules, exports, client build and bundle budget all pass. The e2e passes.

## Owner decisions. Don't reopen these.

- **No unit tests, ever.** Verification is the one e2e, run once at the end with a before/after comparison.
- Stay on the Free plan. pi-durable stays an npm dependency, extended only through `Storage`. Keep FTS search. Keep the UX. Routines keep their exact times.
- **No hacks that weaken durability:**
  - input is durable before the ack;
  - the reply is durable before "done";
  - every completed model turn survives eviction;
  - no acknowledgement lives only in RAM;
  - no `setTimeout` scheduling in a Durable Object.
- **Subagent roles:** the coordinator makes every decision. Codex (GPT-6.1 Sol, medium) takes complex tasks. OpenCode (DeepSeek V4.1 Flash) takes medium tasks. Devin (Haiku 5.5) takes small tasks.
- **Heavy commands** go through `/home/keyur/.cache/kiko-takeover/heavy.sh`, which has two slots. Never `pkill` or `killall` wrangler, workerd or vite; stop only your own PID.

## What's left

### 1. Cut writes from 33 to the target of 8

Where the 33 go, per warm prompt:

| Writes | Source | Next move |
|---|---|---|
| 7 | `messages`: 2 inserts, their indexes and FTS | Keep. Query plans show the hot reads use both indexes |
| 6 | `journal`, one per pi commit | Keep. These are the recovery checkpoints |
| 3 `setAlarm` + 5 SQL | Crash-fallback wakeups for the burst and the run's recovery, each set and then cleared: `owner_meta` upserts and deletes | **Biggest remaining cut, about 7 writes.** Derive both deadlines from rows already written: the burst deadline from the `pending` rows, the recovery deadline from `owner_runs.ready_at`. Then a run in a socket event needs no extra wakeup writes |
| 3 | `pending`: insert 2 + delete 1 | Derive pending input from the `messages` rows after the agent's delivered cursor, and keep that cursor in a row already written |
| 2 | `mem_turns`: one per human or agent turn | Keep, or write one row per prompt |
| 2 + 1 + 1 | `events`, `clients`, `ended_runs` | Keep |
| 2 | Run ticket insert + delete | Keep |

After each cut, lower `ROW_GATE` in `apps/cli/src/verify/suites/journal-overhead.ts` to the new measured cost.

### 2. Prove parallel runs on a real Cloudflare deploy

Each incoming WebSocket message should get its own 50-call budget; that's Cloudflare's per-invocation model, but no deployed probe has run it yet. To test it, deploy a throwaway Worker on a Free account. Have three agents in one room each make about 30 calls, started by one message and then by separate messages. If a run fails with "Too many subrequests", remove the inline step in `OwnerDO.humanInput`; tickets still drain from the alarm.

### 3. Release

After merge, `deploy.yml` publishes `latest-owner.json`. Existing installs need the installer reset (`delete-existing-data`); the in-place updater refuses destructive plans. Tell owners plainly that the update wipes their data.

## Known risks

- **A shared budget ends one event's runs together.** When one tool call is rejected at 40 calls, the other runs from that event end with the visible call-limit error instead of continuing.
- **`room/burst.ts` uses `scheduler.wait`.** It holds a human burst inside its socket event, and its durable wakeup is the crash fallback.
- **Storage still grows.** `mem_turns` and `ended_runs` grow for the life of the install. Only messages move to R2.

## Where things are

| Item | Location |
|---|---|
| Worktree | `/home/keyur/.t3/worktrees/kiko/one-object-integrated` |
| Branch | `one-object/integrated`, based on `origin/main` 7802a45f (v0.4.16). Local `main` in `/home/keyur/kiko` is stale at 6167d2b1 |
| The e2e | `apps/cli/src/verify/suites/journal-overhead.ts`; CI job `verify` in `.github/workflows/ci.yml` |
| Run the e2e | `cd apps/server && NODE_ENV=development bunx wrangler dev --port <n> --persist-to <fresh dir>`, then `bun kiko verify journal-overhead --url http://localhost:<n>` |
| Baseline on `main` | `/home/keyur/.cache/kiko-pr2-baseline`, an older checkout whose CLI still speaks `main`'s two-socket protocol. Run it with `PR2_BASELINE=1` against a `main` server |
| Per-statement write breakdown | `/home/keyur/.cache/kiko-takeover/journal-impl/breakdown-r2.tsv` |
