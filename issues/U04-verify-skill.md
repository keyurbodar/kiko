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
