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

Run the cheapest check that covers your change. Every gate below also runs in CI, and nothing reaches `main` or a release without CI passing.

- **While you work:** `bun run check:changed`. It formats-checks and lints the files you changed, runs knip and the import layering check, checks generated files, and typechecks only the packages you touched plus their dependents. A one-file change takes a few seconds.
- **On commit:** the pre-commit hook runs the same checks on staged files. `bun install` installs it. Do not bypass it with `--no-verify`.
- **Formatting:** `bun fmt` fixes it. Do not hand-format.
- **Before a PR that touches many packages:** `bun run check` runs every static gate across the repo in about 15 seconds.
- **Behavior:** there are no unit or integration tests, and no mocks. Prove behavior against the real app. `bun kiko verify journal-overhead --url http://localhost:8787` drives prompts end to end and fails on extra writes or error rows. `bun run verify:web --url http://localhost:8787` drives the client in Chromium. CI runs both, so run them locally only when you changed the path they cover.
- **UI changes:** look at the change in a real browser before calling it done.

Never silence a rule to pass a gate. Not with a disable comment, not by editing `.oxlintrc.json`, `biome.json` or `knip.json`. If a rule is wrong for this code, say so and get the owner's sign-off.

## Pull requests

- Never push to `main`. Branch, open a PR, and wait for CI.
- Titles are plain sentences that say what changed for the owner: `Keep transcript bubbles visible through loading`.
- Body: the problem in a sentence or two, then the fix, then how you verified it. End with the model and harness that did the work.
- One request is one PR.
- Releases run nightly from `main` and refuse to start until CI is green on the commit they ship. Do not dispatch `deploy` on a commit CI has not passed.

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
