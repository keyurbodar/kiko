# U40a Run every verify suite against real models on main

**Model** Haiku 5.5 medium. **Wave** 4. **Read-only for product code.** **Port** 8840. **Timebox** 3 h.

## Goal
One results table for every suite in `bun yuki verify --list`, run on current `main` with the real dev keys, on one server you own. This is the evidence U40b and the close unit rely on.

## How
1. Work in your worktree (a clean checkout of `main`). Build the client once if `wrangler dev` needs `apps/web-solid/dist` (`bun run --cwd apps/web-solid build`).
2. Start `bun run --cwd apps/server dev --port 8840` in the background, record the PID, wait for health. Load keys: `set -a; . apps/server/.dev.vars; set +a`. Set `YUKI_URL=http://localhost:8840`.
3. Use the existing parallel runner if it fits (`.cursor/skills/verify-yuki-server/scripts/verify-parallel.sh`, read it first), or run suites one by one. Suites that reset dev counters must not share a server with each other running at the same time.
4. Run every suite, model and no-model. Include the browser suites (KERNEL_API_KEY is set) and the initiative suites (follow `.cursor/skills/verify-initiative/SKILL.md`).
5. Re-run each failing suite once. A suite that passes on rerun is `flaky`, with both outputs kept.
6. For each real failure, read the assertion and the output, and say whether it looks like a product bug, a test bug, or load. Do not fix product code.
7. Stop only your server PID.

## Output
Append to this file a `## Results` table: suite, result (pass, flaky, fail, skip), time, and one evidence line. Then a `## Failures` section with your diagnosis per failure, `file:line` where you can. Commit it on your branch.
