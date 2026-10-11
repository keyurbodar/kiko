# U41 Close: enforce every rule, docs match code

**Model** Haiku 5.5 medium. **Wave** 5. **Depends on** everything else. **Timebox** 2 h.

## Goal
Flip every remaining `check-rules` rule to enforce (each leftover site gets a real reason or is fixed). `docs/architecture.md` and `AGENTS.md` match the code: gen-catalog path, removed systems, the egress decision, every DEVIATION labeled, UNVERIFIED labels removed where this program settled them. `bun run check` and `bun yuki verify --no-model` green on `main`.
- U22: docs/architecture.md near line 1076 claims a Free invocation may make 1,000 calls with no UNVERIFIED label; AGENTS.md says 50. Label or fix it.
- U27: `autonomous_taken` now also holds human burst ids for idempotent turn charging; rename it to a neutral name (for example `charged_today`) and update schema-columns.json.

## Rule sites left on main (from `bun scripts/check-rules.ts`)
Each is a bounded wait inside one request or a dev-only path, not scheduled work. Keep each with a `// check-rules: allow <rule> <reason>` line that states that reason in plain words, or fix it if a simpler correct form exists. Then set `enforce: true` for `no-timer-in-do` and `egress`.
- `apps/server/src/router.ts` near 108: a per-request timeout in the Worker, not a Durable Object.
- `apps/server/src/agent/dev-fake.ts` near 162: the dev fake's slow tool.
- `apps/server/src/integrations/kernel/lease.ts` near 60 and `apps/server/src/integrations/composio/limit.ts` near 40: in-request backoff sleeps.
- `core/agent/src/answers.ts` near 23: ask's bounded tool wait, recovered by safe replay (U05 decision).
- `apps/server/src/lib/dev-fixture-fetch.ts`: dev-only fixture fetcher.
- `apps/server/src/integrations/composio/connect.ts` near 26: Composio calls run in UserDO, which gets its own invocation per RPC; the subrequest measurement is gated (G01). Say so in the reason and in architecture.md.

## Docs
- AGENTS.md "Verifying": name `bun run check` as the one gate, `YUKI_URL` for verify runs, and `scripts/check-rules.ts` as where rules are enforced.
- Remove UNVERIFIED labels only where a landed unit settled the claim; leave the subrequest items labeled until G01.
- `issues/PLAN.md` is the coordinator's; do not edit it.
- U35: `.cursor/skills/verify-initiative/scripts/server.sh start` runs `bun dev:server`, which hardcodes port 8787; make it start on the port from `YUKI_URL` (or a `--port`) so it never collides with another session.
- U35: `initiative-loops` Jev arm polls `/run/` and can match the explicit "beginner running plan" loop instead of the tentative "start running" one; tighten the match so the suite is not flaky.
- U35: delete the stale baseline line `apps/server/src/user/reminders.ts:MAX_FAILS` from `scripts/exports-baseline.txt`.

## Report

**STATUS** done. Every check-rules rule is enforced, and the docs match the code for the items the brief names.

**Rules.** The eight remaining `no-timer-in-do` and `egress` sites each carry `// check-rules: allow <rule> <reason>` on the line above. `dev-fixture-fetch.ts` routes its three calls through one `network` transport line, since `safeRequest` already checks the host before the fetcher runs. Both rules are `enforce: true` in `scripts/check-rules.ts`. A probe file with a bare `setTimeout` and a bare `fetch` fails the scan with two violation lines (exit 1), then the probe is deleted.

**U22.** `architecture.md` no longer has the 1,000-call Free claim in §17.3, which says 50. The claim survived in the bash section (about line 1084) as "a Free invocation may make 1,000 calls". It now says the 400-file read cap is UNVERIFIED until G01 (R2 reads against the 50). The number stays, as U22 asked.

**U27.** `autonomous_taken` is `charged_today` in `schema.ts`, `user-do.ts`, `schema-columns.json` (table and index name), and the architecture doc. The table also holds burst ids, which the doc now says.

**U35.** `server.sh start` runs `bun run --cwd apps/server dev --port "$PORT"` (the port from `YUKI_URL`), not the root `dev:server` alias that pins 8787. The Jev poll in `initiative-loops` matches `/start running/i`, so the explicit beginner-plan loop cannot match. The stale `MAX_FAILS` baseline line is gone (209 to 208 baselined).

**Docs.** AGENTS.md names `bun run check` as the gate, `YUKI_URL` for verify runs, and `scripts/check-rules.ts` as the rule enforcer. Its catalog path is `apps/server/scripts/gen-catalog.ts`, and so is architecture's. `architecture.md` §17.3 has the egress decision: the two reasoned exceptions and an UNVERIFIED label on the RPC and R2 counts until G01. The doc no longer claims `alarm.ts` has `history()`, which it does not. Four DEVIATIONs from landed units are recorded (wipe refusal, no token rotation, the rest cap, the extension section key), plus the browser tab-cap gap and the Jev recall caveat.

**UNVERIFIED labels.** None removed. The audit (haiku, medium, read-only) checked all eleven labels in `architecture.md` against the landed unit reports. None has a landed test or measurement that settles its exact claim. The subrequest labels stay until G01.

## Discoveries
- No landed unit settled any UNVERIFIED label in `architecture.md`. The Jev recall, the Kernel timings, and the rerank item still need a live run or a deploy.
- Still not in `architecture.md`: U30 (413 for every `/api` JSON body over 1 MB), U26 (refused routine runs count through `finishRun`, and a failed webhook insert deletes the row), U31 (the CLI default URL), U35 (human task changes reach `UserDO` only when a routine matches). I did not add these. They are FOLLOW-UPS.
- The `.cursor/skills/verify-yuki-server/` docs and the root `package.json` `dev:server` still pin port 8787.

**VERIFIED**
- `bun run check`: all 10 steps passed, exit 0 (`/tmp/u41-check-2.log`). Frontend lint shows 17 errors, which is non-gating and known. The `apps/server` step is cached from the identical server code (the first run, `/tmp/u41-check-1.log`, ran it for 136.1 s).
- `bun scripts/check-rules.ts`: `check-rules ok`, zero findings, `no-timer-in-do` and `egress` enforced. Before this change the same scan printed 8 "(report only)" findings and exited 0.
- `bun scripts/check-exports.ts`: `check-exports ok: 199 files, 208 baselined`.
- `bun scripts/check-imports.ts`: `imports ok`.
- `bun run typecheck`: all packages exit 0.
- `bunx biome check apps/server core apps/cli scripts`: exit 0, 8 warnings, none in the code I changed (`check-rules.ts:90` is pre-existing).
- `bun run --cwd apps/server test -- schema-columns router limits`: 7 pass, 0 fail.
- `bun run --cwd apps/server test -- user.test composio-limit kernel-lease composio-tools`: 76 pass, 0 fail.
- `bun test scripts/check-rules.test.ts`: 3 pass, 0 fail.
- `bun yuki verify --no-model --url http://localhost:8841` on my own server (PID 222000, stopped with its tree): `VERIFY_EXIT 0`, 33 `pass` lines, no `fail` lines (`/tmp/u41-verify.log`).
- `server.sh start` with `YUKI_URL=http://localhost:8842`: up, `/api/health` ok, `doctor` reports listening on 8842, `stop` stopped its PID tree, and nothing listens on 8842 afterwards.

**FAILED-BEFORE**
- Rules flip: before, the scan reported 8 findings as "(report only)" and exited 0. After, a probe with a violation exits 1.
- Not reproduced: the `charged_today` rename (the `schema-columns` check passes on the new fixture, but I did not run the old code against it), the `server.sh` port change (the old script ran `bun dev:server`, which pins `--port 8787` in root `package.json`, but I did not run the old script), and the Jev match (no real-model run, see DEVIATIONS).

**DEVIATIONS**
- `initiative-loops` was not run with real models. It needs keys and costs tokens, and the change is one regex. This is the one suite that the change alters and that the no-model gate does not cover.
- The catalog path is `apps/server/scripts/gen-catalog.ts`, not the `scripts/gen-catalog.ts` the brief named. The root `scripts/build-catalog.ts` is a different script.
- `dev-fixture-fetch.ts` has one `network` helper with one allow line, not three allow lines. It is the transport under `safeRequest`.
- Existing dev databases keep the orphan `autonomous_taken` table after the rename. Nothing reads it, and the rename resets today's charge count once in dev.
- Commit trailers: standing order 14 asks for `Co-Authored-By: Claude Opus 5.5`. I used `Co-Authored-By: Claude Haiku 5.5` per the harness attribution rule. The two earlier commits (`ae8b36f0` wip and `fd9bf407` docs) have no trailer. I did not rewrite them.

**FOLLOW-UPS**
1. Record in `architecture.md`: U30 (413 for every `/api` JSON body over 1 MB), U26 (refused-run accounting, failed webhook insert), U31 (CLI default URL), U35 (human task changes reach `UserDO` only when a routine matches).
2. Update `.cursor/skills/verify-yuki-server/` and the root `dev:server` script away from the hardcoded 8787.
3. Run `initiative-loops` once with real keys to confirm the tightened match.
4. Eight backend lint warnings and the 17 frontend lint errors were already on `main`. Fix in a separate unit.
5. G01 settles the subrequest UNVERIFIED labels and the 400-file read cap.
