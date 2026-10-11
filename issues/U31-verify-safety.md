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
