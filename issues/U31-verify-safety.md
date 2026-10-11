# U31 Verification can never touch another session's server

**Model** DeepSeek V4.1 Flash high. **Wave** 2. **Depends on** nothing. **Timebox** 45 min.

## Findings (U04)
1. `apps/cli/src/main.ts:9` hardcodes `defaultUrl = "http://localhost:8787"`, which is another session's server. A suite run without `--url` created users and rooms there. Make the default `process.env.YUKI_URL ?? "http://localhost:8787"`, and print the URL the run targets on its first line so a wrong target is visible. Update the usage string.
2. `.cursor/skills/verify-initiative/scripts/server.sh:38` kills every process listening on 8787, and `doctor` and `stop` need `lsof`, which is not installed here. Stop only the recorded PID and its children; use `ss -ltnp` when `lsof` is missing. Check `.cursor/skills/verify-yuki-server/scripts/verify-parallel.sh:65` for the same `lsof` dependency and give it the same fallback.
3. One line in each of the two SKILL.md files: set `YUKI_URL` to your own server.

## Scope
`apps/cli/src/main.ts` and its test if one covers the URL, the two scripts, the two SKILL.md files.

## Acceptance
`YUKI_URL=http://localhost:9 bun yuki health` fails against port 9, proving the env var is used. `bun run --cwd apps/cli test` green. `sh -n` passes on both scripts.

## Report

STATUS done.

CHANGED
- `apps/cli/src/main.ts`: `defaultUrl` is `process.env.YUKI_URL ?? "http://localhost:8787"`; `main` prints `yuki: target <url>` to stderr; usage string names the default.
- `apps/cli/src/cli.test.ts`: `run` takes an env override; the down test now expects the target line plus one error line; two new tests cover `YUKI_URL` and `--url` precedence.
- `.cursor/skills/verify-initiative/scripts/server.sh`: `stop` kills only the recorded PID and its descendants; `doctor` reads listeners with `ss -ltnp` when `lsof` is missing; port comes from `YUKI_URL`.
- `.cursor/skills/verify-yuki-server/scripts/verify-parallel.sh`: same `lsof`/`ss` fallback for the port-in-use check; the bash array became a plain string so the script parses under `sh`.
- `.cursor/skills/verify-initiative/SKILL.md`: names `YUKI_URL` and the new CLI target line; cleanup text says `stop` touches only its own PID.
- `.cursor/skills/verify-yuki-server/SKILL.md`: one line setting `YUKI_URL` for every command.

VERIFIED
- `YUKI_URL=http://localhost:9 bun yuki health` prints `yuki: target http://localhost:9` then `yuki: health failed: cannot reach http://localhost:9`, exit 1. Env var is used.
- `bun run --cwd apps/cli typecheck` clean.
- `bun run --cwd apps/cli test`: 10 pass, 0 fail.
- `sh -n` and `bash -n` pass on both scripts.
- `server.sh stop` with a stand-in tree: killed the recorded parent and its children, left an unrelated `python3 -m http.server` on the same port alive (unrelated alive? YES, parent alive? NO).
- `server.sh doctor` printed `listening on 8799:` via `ss` with no `lsof` installed.
- `verify-parallel.sh --cleanup` rc=0, no-args usage rc=2.
- `bun scripts/check-rules.ts`, `bun scripts/check-exports.ts` (197 files, 209 baselined), `bun scripts/check-imports.ts`: ok.
- `bunx biome check apps/server core apps/cli scripts`: 4 pre-existing warnings, exit 0.

FAILED-BEFORE
- `bun test apps/cli/src/cli.test.ts -t "YUKI_URL sets the default target"` against the old `main.ts`: `0 pass, 1 fail`, `Expected: "yuki: target http://localhost:40927" / Received: ""`. On the old code the run also reached another session's workerd on 8787, which is the bug.

DEVIATIONS
- The brief only asked for the `lsof` fallback in `verify-parallel.sh`. Its `pids=()` bash array also failed `sh -n` on both old and new code. The acceptance requires `sh -n` on both scripts, so I replaced the array with a string list. Behavior is unchanged.

FOLLOW-UPS
- None.

