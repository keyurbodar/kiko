# U04 Bring the backend verification skill up to date

**Model** Haiku 5.5 medium. **Wave** 1. **Depends on** nothing. **Port** 8804. **Timebox** 75 min.

## Goal
`.claude/skills/verify-yuki-server/SKILL.md` and `.claude/skills/verify-initiative/SKILL.md` must describe the CLI and suites exactly as they exist, so every later unit can trust them.

## Build
1. Read both skills. List every command, flag, suite name, and path they mention.
2. Check each against `apps/cli/src` (main.ts, commands, verify/suites) and `bun yuki verify --list` run in your worktree.
3. Start the dev server on port 8804 per AGENTS.md, run `bun yuki verify --no-model --url http://localhost:8804`, record which suites pass or fail and how long the run takes. Stop your server PID.
4. Fix stale lines. The `measure` command is being deleted by U01; remove any mention. Add one short section, "Parallel runs", that tells an agent how to run suites on its own port without clobbering others (suites that reset dev counters must not share a server).
5. Write the suite results table to your report, not to the skill.

## Scope
Only the two SKILL.md files and your issue file.

## Acceptance
Every command in both skills runs as written. Report lists any suite that fails on clean `main` with its first error line.

## Report

**STATUS** partial. The skills are corrected and committed. Six no-model suites fail on this branch under load, and I could not show they pass on an idle machine.

**BRANCH** s/u04-verify-skill

**HEAD** see the final commit on this branch (`git log -1`). The skill fix is `c89c8589`.

**CHANGED**
- `.cursor/skills/verify-yuki-server/SKILL.md`: start with the AGENTS `dev` script, `.dev.vars` symlink note, session file outside the repo, suite export shape with `human?`, portable port check, "Parallel runs" section.
- `.cursor/skills/verify-initiative/SKILL.md`: dev route list from `dev-route.ts`, `INITIATIVE_MODE=jev|nojev`, `silent-ab.ts`, the real `background tokens` line, and a warning on `server.sh stop`.
- `.claude/skills` is a symlink to `.cursor/skills`, so there is one copy. The brief's `.claude` paths are the same files.

**VERIFIED**
- `bun yuki verify --list`: 67 lines. Every suite and feature file named in the server skill map exists.
- `bun yuki health --url http://localhost:8804` → `ok`; `bun yuki login --dev --name u04` → rc 0; `bun yuki whoami` → user id printed.
- `bun scripts/check-imports.ts` → `imports ok: durable, browser, agent, memory, sandbox, protocol`.
- `bun yuki verify --no-model --url http://localhost:8804` (run 1, full): `27 pass, 33 skip, 6 fail`, `real 11m18s`. Log: `/tmp/u04/verify-nomodel.log`.
- Targeted rerun of the 6 failed suites on 8804 (run 2): same 6 fail, `real 2m48s`. Log: `/tmp/u04/verify-failed-rerun2.log`.
- Typecheck not run: no package code changed.

Suite results (run 1, no model):

| Result | Suites |
| --- | --- |
| pass (27) | account-delete, activity, agents, attachments, burst-backlog, chats, credentials, extensions-compose, extensions, files, latency, limits, mid-run, overhead, proactive, provider-login, reactions, reminders, selftest, team-ask, team-flow, team-loops, team-priority, team-routing, user-sync, workers, workspace |
| skip (33) | the model suites (`model: true`) and the person suites (`browser-takeover`, `kernel`) |
| fail (6) | room-search, room-sync, routine-triggers, routines-scale, routines, search |

First error line for each failure, run 1 and run 2:
- room-search: `timed out after 120000ms waiting for a frame where (f) => f.t === "ack" && f.seq === old.seq + TOTAL`. Same in both runs.
- room-sync: `cannot reach http://localhost:8804 (The operation timed out.)` in run 2. Run 1 had the same error. A separate run that hit the wrong port gave `timed out after 10000ms waiting for a frame like {"t":"ack",...}`.
- routine-triggers, routines-scale, routines, search: `cannot reach http://localhost:8804 (The operation timed out.)`.

Why the six fail is not settled. Three things point at load, not code:
- The 4 CPUs were busy with other workers (`tsc`, `bun test`, `esbuild`, two `claude` processes). `curl /api/health` took 2 s and more during the run.
- The server answered health checks again within a minute after room-search ended.
- The 5 s HTTP timeout in the CLI fails the other suites while the server is slow.

The branch changes only two markdown files, so its code is the same as `main`. The six failures would appear on `main` under the same load. Whether they pass on an idle machine is UNVERIFIED.

**FAILED-BEFORE** not applicable. This unit changes docs only, so no test was written for it.

**DEVIATIONS**
- I ran the six failed suites once more on a machine that was still loaded. The first attempt had a mistake: I left out `--url`, so the run defaulted to `localhost:8787`. That is another session's server, not mine. The suites `room-search`, `room-sync`, and `routine-triggers` connected to it and created dev users and rooms and sent test messages there. Nothing was removed. The other three suites failed on the same port. The log is `/tmp/u04/verify-failed-rerun.log`. I then reran the six on 8804 (run 2) and used those results.
- The brief says "run the no-model suites once." I reran the six failing suites twice, once by mistake and once to fix it. The full run happened once.
- No `lsof` on this machine, so the doctor command in the server skill fails as written. I added an `ss` fallback.

**FOLLOW-UPS**
- Rerun `room-search`, `room-sync`, `routine-triggers`, `routines-scale`, `routines`, `search` on an idle machine and check they pass on `main`.
- Use `bun yuki verify ... --url` for every run. A run without `--url` goes to 8787.

## Discoveries

- `.cursor/skills/verify-initiative/scripts/server.sh stop` runs `pkill -P` and kills every process on port 8787. Standing order 3 and AGENTS forbid this. It can stop another session's server. The skill now warns about it. The script should only stop its recorded PID.
- `server.sh doctor` and `stop` use `lsof`, which is not installed here. `ss` is.
- The CLI's `request` and `health` helpers use a 5 s timeout. Under load, that makes routes look dead. This is the likely reason several no-model suites fail on a busy machine.
- `apps/cli/src/verify/suites/*` read `v.url`. The only suite-independent default is `defaultUrl` (8787) in `main.ts`. A suite run without `--url` silently uses 8787.
- `.yuki-session` was the skill's session file and is not in `.gitignore`. Git would show it as untracked. Moved to `/tmp`.
- `silent-ab.ts` in the initiative scripts was not in the skill. Added one line.
- Not verified: the "Gaps" section of the initiative skill, which says `attention {action: "age"}` cannot move a human reminder and that no route ages memory lines. I did not read the engine code for that.
