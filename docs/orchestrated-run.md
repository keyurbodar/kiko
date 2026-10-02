# Orchestrated run rules

These rules replace `docs/task-prompt.md` for a run where one coordinator starts many task agents at once. There is no git remote and there are no pull requests. The coordinator merges your commit into the branch `kiko/build`.

## Steps

1. You are in your own git worktree. Run `git merge kiko/build` first. That gives you every merged dependency. Then run `bun install`.
2. Read your issue file, `AGENTS.md`, `docs/overview.md`, and only what the issue's "Read first" names.
3. Do not check dependencies. The coordinator started you because they are merged.
4. Build what "Build" lists, inside the files "Files" lists.
5. Run the "Verification" line and "Done when" against the real thing. Run `bun run typecheck` and `bun test` when those scripts exist.
6. Commit everything on the branch your worktree is already on. The subject is `<id> <task title>`. Do not push. Do not switch branches. Do not touch `kiko/build` or another worktree.
7. Stop every process you started.
8. Send the final report.

## Secrets

- Local secrets are in `~/.config/kiko/dev.vars`. It holds `OPENCODE_API_KEY`, `CREDENTIALS_KEK`, and `BETTER_AUTH_SECRET`.
- For the Worker, run `cp ~/.config/kiko/dev.vars apps/server/.dev.vars`. That file is ignored by git.
- For a shell command, run `set -a; source ~/.config/kiko/dev.vars; set +a`.
- Never print a value, write one into a tracked file, a log, a test fixture, or your report.

## The model

- The provider is OpenCode Go. In `pi-ai` the provider id is `opencode-go` and it reads `OPENCODE_API_KEY`.
- The model is DeepSeek V4.1 Flash. Find its exact id in the installed `@earendil-works/pi-ai` catalog. Do not guess the id.
- Spend few tokens. Use short prompts in tests that call the model.

## Ports and processes

The machine has 8 GB of memory and many agents share it.

- Use only the three ports the coordinator gave you: server, inspector, and web.
- Start the Worker with `bunx wrangler dev --port <server> --inspector-port <inspector>`. Start the client with `--port <web> --strictPort`.
- Never run a watcher, a second dev server, or anything you leave running.
- Stop only your own processes: `lsof -ti :<port> | xargs kill`. Never run `pkill` or `killall`.

## Shared files

Several agents edit the same few files: the root `package.json`, `apps/server/wrangler.jsonc`, `apps/server/src/index.ts`, and `bun.lock`. Keep each edit to those files as small as you can, and add lines instead of reordering them. The coordinator resolves `bun.lock`.

## When to stop early

Stop and report when the issue disagrees with the code, or when verification will not pass. Never weaken the verification. When a step needs a human, do everything else first and say exactly what is needed.

## The final report

Keep it under 150 words. Include:

- the branch name and the commit sha
- the verification result, with the one line of output that proves it
- every file you touched outside "Files"
- anything left open, still UNVERIFIED, or waiting on a human
- any fact another task needs, such as an exact model id or a changed interface

## Facts from merged tasks

The coordinator adds to this list as tasks land.

- `apps/server/wrangler.jsonc` serves assets from `../web-solid/dist`, which git ignores. If `wrangler dev` or `wrangler deploy --dry-run` complains about the assets directory, run `bun run build` in `apps/web-solid` first.
- Run `bun test` inside a package directory. At the repo root it picks up reference code and fails.
- The root `dev:server` script uses port 8787. Do not use it in this run. Start wrangler with your own ports.
- Server tests run in workerd through Miniflare. See `apps/server/test/alarm.test.ts` and `test/alarm-worker.ts` for the pattern. Use compatibility date `2026-07-01` in tests, because the installed workerd rejects later dates.
- `apps/server/src/lib/alarm.ts` exports `createAlarms(ctx)` which returns `{ setWakeup(key, at), clearWakeup(key), dueWakeups(now) }`. `dueWakeups` removes the due keys and re-arms the alarm for the rest.
- The CLI entry is `apps/cli/src/index.ts`, which calls `main()` in `apps/cli/src/main.ts`. It has `health` and `ws` commands.
- `.wrangler/` is ignored by git. Never commit it.
