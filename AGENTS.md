# kiko

Kiko is a self-deployed chat app where one person texts one agent or a team of agents. Each owner runs their own copy on Cloudflare Workers with their own model keys. The client is SolidJS.

## What we never compromise on

1. **One owner, one Worker.** Every install serves exactly one person. Keep every feature, but cut any machinery that only exists for multi-tenant scale.
2. **Writes are the budget.** Cloudflare bills rows written, and the Free plan allows 100,000 a day. A warm prompt writes at most 7 rows. A change that adds a write per prompt, per minute, or per open tab is a regression even when it works.
3. **The client never waits.** It paints from IndexedDB and applies every action locally before the server answers. Navigation and the composer do not animate or block on the network.
4. **Production stays up.** Owners update from our releases. A crash we ship lands in every install at once.

## Glossary

- **owner** is the one person a Worker serves.
- **you** is the agent changing this repo. **agent** means a model-driven room member inside kiko.
- **room** is one human plus one or more agents. **lead** is the agent that gets untagged messages.
- **journal** is an agent's durable state, one row per finished model turn.
- **worker** is a background child conversation inside an agent. It is not a room member and not a Cloudflare Worker.
- **release** is a signed build that owners' installs update to.

## The ways to hurt yourself

1. **Reading a `let` before it is declared.** Solid's `createMemo` and `createEffect` run their body at once. A closure that reads a variable declared further down crashes the component, and TypeScript does not see it. This shipped to production. Lint rejects it (`eslint/no-use-before-define`); fix the order, never the rule.
2. **Killing by pattern.** Never `pkill -f` or kill a PID found by name. Other dev servers and agents run on this machine. Kill only the PID you started, or the owner of your port after checking its cwd.
3. **Writing secrets.** Model keys live in `apps/server/.dev.vars`, which is gitignored. Never commit it, print it, or paste it into a PR.

## Dev servers

```bash
bun install
bun dev:server   # Worker on localhost:8787
bun dev:web      # client on localhost:5173
```

Copy `apps/server/.dev.vars.example` to `.dev.vars` for local runs. If a port is taken, pick another one rather than stopping someone else's server.

## Verifying

Run the cheapest check that covers your change. CI runs every gate again, and nothing reaches a release without the `Check` job passing.

- **Before you push:** `bun run check:changed`. It runs CI's fast checks for the files you changed: format, lint, knip, import layering, generated files, typecheck of the packages you touched plus their dependents, and the test files beside your changes. A passing result is cached, so a rerun with no new changes returns at once. The pre-push hook runs it. Do not bypass it with `--no-verify`.
- **On commit:** the pre-commit hook formats staged files. `bun install` installs both hooks.
- **While you iterate:** `bunx vitest run <files>`. Add `-t "<name>"` for one test.
- **Formatting:** `bun fmt` fixes it. Do not hand-format.
- **Do not run repo-wide checks** unless asked. CI owns the full suite.
- **Tests:** test logic and observable behavior beside the source as `*.test.ts`, with `@effect/vitest` for Effect code (`it.effect`, `TestClock`, `Deferred`, `Queue`). Client DOM tests are `*.browser.test.tsx`, run in Chromium, and render with `await using screen = await render(...)` from `apps/web-solid/test/render.tsx`. No sleeps, polling loops, wall-clock deltas, per-test timeouts or retries; lint enforces this (`oxlint-plugin-kiko`).
- **Bug fixes:** logic, state and protocol bugs get a failing test first, then the fix. Purely visual bugs get before/after captures instead.
- **Writes budget:** `apps/server/integration` starts the real Worker and fails if a warm prompt writes more than 7 billed rows or an idle minute writes anything. CI runs it when server or core code changes.
- **UI changes:** look at the change in a real browser before calling it done.

Never silence a rule to pass a gate. Not with a disable comment, not by editing `.oxlintrc.json`, `biome.json` or `knip.json`. If a rule is wrong for this code, say so and get the owner's sign-off.

## Pull requests

- Never push to `main`. Branch, open a PR, and wait for CI.
- Titles are plain sentences that say what changed for the owner: `Keep transcript bubbles visible through loading`.
- Body: the problem in a sentence or two, then the fix, then how you verified it. End with the model and harness that did the work.
- One request is one PR.
- Releases run nightly from `main`. `main` only takes merges whose `Check` and `E2E` jobs passed, so do not dispatch `deploy` on any other ref.

## Code

- No comments. If something needs explaining, it is either a name that should be better or a constraint that belongs in `ARCHITECTURE.md`.
- Keep functions under Biome's cognitive complexity limit of 30. Split the function, do not raise the limit.
- `core/` and `packages/` never import `apps/`, and each package only imports the packages listed in `scripts/check-imports.ts`.
- No runtime import cycles. Lint fails on them (`import/no-cycle`).
- Exports with no importer get deleted. knip fails on them.
- Generated `*.gen.ts` files come from `apps/server/scripts/gen-*.ts`. Edit the source Markdown, not the output.
- Do not commit plans, notes, reports, screenshots or scratch files.

## Where code lives

- `apps/server` - the Worker and its one Durable Object, `OwnerDO`.
- `apps/web-solid` - the SolidJS client.
- `apps/cli` - `bun kiko`, a terminal client and the e2e runner.
- `apps/installer` - deploys and updates an owner's Worker.
- `apps/landing` - the marketing site.
- `core/*` - runtime libraries shared by the server: agent host, durable helpers, protocol, memory, sandbox, browser.
- `packages/*` - client libraries: UI components, themes, avatars.

How it fits together, and the constraints behind it: `ARCHITECTURE.md`.
