# Single-owner program (shared brief for SO1 to SO5)

Read issues/STANDING.md and AGENTS.md first. The standing orders apply, with these overrides.

Decision: yuki is self-deployed. One Worker serves one owner. Every feature stays. Multi-user machinery, account deletion, quotas, budgets, and anything built only for many users goes. Prefer deleting to adding, and prefer one code path to two. Delete what your change makes dead, including its tests, CLI suites, dev routes, and schema columns. Never edit an existing schema step. Append a step to drop a table or column when that matters, and otherwise leave old columns alone.

Audit evidence lives in issues/audit-simplify/*.md. Use it as a map, and confirm every claim against the code before you cut.

Rules for this program:
- Timebox: 35 minutes. Commit early as wip commits, and leave the branch clean.
- Start with `git merge main`, because main has moved.
- Verify only what you touched. Run `bun run typecheck`, the server test files that cover your change, `bunx biome check apps/server core apps/cli scripts`, `bun scripts/check-imports.ts`, `bun scripts/check-rules.ts`, and `bun scripts/check-exports.ts`. Run all of them through /home/keyur/kiko/issues/bin/heavy.sh. Do not run the full gate; the coordinator runs it at landing. Do not run model suites.
- A test that only covered deleted behavior is deleted. A test that covers kept behavior must still pass.
- Do not touch docs/ or AGENTS.md. The coordinator rewrites them at the end. List doc lines that became wrong under FOLLOW-UPS.
- Report in the STANDING shape, and add `LINES` with `git diff --shortstat main...HEAD`.
