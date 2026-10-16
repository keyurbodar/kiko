# kiko

Kiko is a general-purpose AI chat web app that feels like Telegram. People text one agent or a team of agents. It runs on Cloudflare Workers and Durable Objects, with a SolidJS client. Kiko is self-deployed: one Worker serves one owner, who brings their own model keys.

Read `docs/overview.md` before your first task. `docs/architecture.md` has every decision and its reason. Follow it, or change it in the same pull request and say why.

## What makes kiko special

These are not negotiable. A change that breaks one is wrong even if it works.

1. **Instant.** Navigation, route changes, tabs, buttons, and the composer have 0 ms of animation and never wait on the network. The app paints from IndexedDB first. Motion is allowed where it never delays input: overlays entering and leaving (dialogs, the palette, popovers, menus, tooltips) with t3code's timings, toasts, and waiting states (spinners, skeletons, progress, busy labels). Honor `prefers-reduced-motion`.
2. **Optimistic.** Every user action applies locally before the server answers.
3. **Human pacing.** An agent reads a burst of messages together and answers once, in short bubbles.
4. **The human outranks every agent.** A human message is handled first and can interrupt work.
5. **One owner per Worker.** Only the Worker builds a Durable Object name, through `apps/server/src/lib/names.ts`, always from the session's owner id (`"owner"` in production). A routine's webhook has no session, so the Worker sends it to the owner's object (architecture D9).
6. **Keys stay on the server.** A credential is encrypted in `UserDO`, never logged, and never sent to the client.
7. **Sentence case.** Interface strings are sentence case, as in monocode and t3code: "Accent color", "Sign out". Names keep their own casing: Kiko, Anthropic, Claude Opus 4.6, Open VSX.

## Glossary

- **Room.** A chat. One human and one or more agents. `RoomDO`.
- **Agent.** A member of a room with its own Durable Object, inbox, and `pi-durable` harness. `AgentDO`.
- **Lead.** The one agent in a room that gets untagged messages and may add agents.
- **Worker.** A background child conversation inside an agent's own object. It runs slow work while the agent keeps talking. Not a room member.
- **Burst.** The human messages that arrive before a pause. Delivered together.
- **Run.** The model turns from one input to its final answer.
- **Envelope.** A message as delivered to an agent, with sender, hop count, and root id.
- **Brief.** The workspace summary the room attaches to each delivery.
- **Tier.** A group of client code by load time. Tier 1 is the HTML shell.
- **Extension.** A user's manifest and script that adds tools, instructions, hooks, or schedules to agents at run time. It runs in QuickJS inside `AgentDO`. Only the human installs one. Architecture section 24.

## Ways to hurt yourself

- **`pi-durable` is an npm dependency.** Extend it through its extension points only.
- **Do not wait on another Durable Object inside `receive()`.** Store, set an alarm, return. Two agents that wait on each other deadlock.
- **Do not do CPU-heavy work in a Worker handler.** On the Free plan they are stopped at random from about 0.15 s of CPU. Put it in a Durable Object, which has 30 s per request. Architecture section 17.3.
- **Do not fetch the outside from an agent's run except through `egress`.** A run's work belongs to one invocation, and Free allows 50 subrequests per invocation. Model requests and `web_fetch` already go through `AgentDO.egress`.
- **Do not bind one SQL value per item of a list.** A query binds at most 100. Pass the list as one JSON value and read it with `json_each(?)`.
- **Do not add a table anywhere but its object's step list.** Every table is one versioned step at the end of the list in `schema.ts`, run by `migrate` in `core/durable/src/migrate.ts`. Appended, never edited or moved, and safe on a table that already exists.
- **Do not use `setTimeout` to schedule work in a Durable Object.** It does not survive eviction and it blocks hibernation. Use `alarm.ts`.
- **Do not write a handler that is unsafe to run twice.** Alarms deliver at least once. Give every delivery and post a stable id.
- **Do not add a tool without an effect.** Every tool declares `read`, `write`, `message`, or `external`.
- **Do not build an agent outside `factory.ts`.** It is the one place that selects extensions.
- **Do not give an extension script a way out except the bridge in `core/sandbox/src/compile.ts`.** The VM has no I/O by design. A new `kiko.*` power is a manifest permission, a check in the bridge, a line in `describeManifest`, and a test.
- **Do not let anything but the human's socket install an extension.** Agents and the catalog only propose.
- **Do not import `apps/` or `@kiko/protocol` from `core/durable`, `browser`, `agent`, `memory`, or `sandbox`.** They are reusable. Pass kiko's behavior in as an option. `scripts/check-imports.ts` fails the build.
- **Do not read `process.env.NODE_ENV` outside `apps/server/src/lib/dev-guard.ts`.** Dev-only code loads through that module, so a production build drops it. `bun run --cwd apps/server deploy` forces `NODE_ENV=production`.
- **Do not import Effect, CodeMirror, or a markdown parser into client tiers 1 to 3.** The budget script fails the build.
- **Do not add a model list, a provider adapter, or a Composio tool name.** Those come from `pi-ai` and from Composio at run time.
- **Do not commit a secret.** Keys live in `.dev.vars` and in CI secrets. `OPENCODE_API_KEY` is read from the environment.
- **Do not build** notifications, share links, a terminal, a browser panel, or anything on Convex.
- **Do not add a second owner.** No sign-up, no accounts for other people, and no database for accounts. The access code and the owner's session are the whole access model.

## Dev servers

```bash
bun install
bun dev:server        # the Worker and Durable Objects on localhost:8787 (wrangler dev)
bun dev:web           # the client on localhost:5173, proxying /api to the server
```

Wrangler signs in and stores the session with `wrangler login`. Use `localhost`, not `127.0.0.1`, for the client.

Several sessions run dev servers at once. Never `pkill` or `killall` wrangler, workerd, or vite: it stops other sessions' servers mid-run. Start yours on a free port (`bun run --cwd apps/server dev --port <n>`, then `bun kiko verify <suite> --url http://localhost:<n>`) and stop only its PID.

Dev-only sign-in: `/api/auth/dev/session?name=<name>` returns a bearer token for a named dev owner. A browser that opens it with GET lands on `/#token=...` and the dev client stores the token. Fetch it with POST or curl when the client runs on another origin. `dev-guard` loads it only in a development build, and it refuses any host that is not local. Each verify suite uses its own name, so its data stays apart.

Dev keys live in `~/.config/kiko/dev.vars`. The directory keeps its old name, and so does `~/.config/kiko/cli-session.json`. Every worktree's `apps/server/.dev.vars` links to it; a git hook adds the link to a new worktree. Never ask the owner to paste a key. The CLI reads keys from the shell: `set -a; . apps/server/.dev.vars; set +a`.

## Verifying

A change is not done until it is verified and you have shown the output. Tests alone are not enough.

```bash
bun run check                     # the one gate: typecheck, backend lint, imports, rules, exports, script tests, every package's tests
bun run typecheck
bun run test                      # every package's tests: client, cli, server, core/browser, core/protocol (a bare `bun test` at the root fails)
bun run --cwd apps/server test    # server: one process per file, each boots its own workerd
bun kiko verify --list            # backend suites
bun kiko verify <suite> --url http://localhost:<n>   # one suite; or set KIKO_URL (the default port 8787 belongs to other sessions)
bun kiko verify --no-model --url http://localhost:<n> # everything that needs no model key
bun scripts/bundle-budget.ts      # client tier sizes
bun scripts/check-imports.ts      # packages import only the packages below them
```

- `bun run check` is the gate a change must pass before it lands. `scripts/check-rules.ts` enforces the rules under "Ways to hurt yourself" (`no-timer-in-do`, `egress`, `dev-guard`, `do-names`, `sql-list-binds`). A reasoned exception goes on the line above the code as `// check-rules: allow <rule> <reason>`.
- Wrap every heavy command (the gate, a test run, a typecheck, a dev server, `bun kiko verify`) in `issues/bin/heavy.sh`. The machine has 4 CPUs, and at most eight heavy commands run at once (issues/STANDING.md).
- Backend work is verified through the kiko CLI, which speaks the same protocol as the client. Add or extend a suite in the same pull request as the feature.
- Frontend work is verified with the `verify-kiko` skill, which drives a real browser. Use it for checks that matter, not for every change.
- Team and loop behavior is tested with fake agents first, so tests are deterministic and cost no tokens.
- Keep a check under 5 minutes: run only the suites the change touches. Suites that reset and read the server's dev counters clobber each other, so run those one at a time or on separate servers.
- Do not write a test that only proves the code runs. A test must fail when the behavior breaks.

## Subagents

Pick the model with [`docs/subagents.md`](docs/subagents.md). Run every subagent at `medium` effort.

## Pull requests

- One change is one pull request.
- If `bun.lock` conflicts, take the base version and run `bun install`.
- Commit messages and pull request descriptions say what changed and why, in plain sentences.
- When your branch is merged into `main`, clean up before you finish:
  - Confirm it is merged. `git branch --merged main` must list the branch. If it does not, stop.
  - Check the worktree with `git -C <path> status --short`. If anything is listed, stop and ask. Do not discard it.
  - Stop only the dev server PIDs this session started. Never `pkill` or `killall`.
  - Run `git worktree remove <path>`, then `git branch -d <branch>`. Use `-d`, never `-D`.
  - Never remove `main`, or a worktree or branch this session did not create.

## Documentation rules

- Label a choice the spec did not make as ASSUMPTION, a fact you could not confirm as UNVERIFIED, and a departure from the spec as DEVIATION.
- Never invent an API, a package feature, or a limit. Check the official docs.
- When a task settles an UNVERIFIED item, remove the label in `docs/architecture.md` in the same pull request.
- Write short sentences. No em dashes. Sentence-case headings.

## Where code lives

Reusable backend packages live in `core/` (`@kiko/*`, importable by apps and by each other by layer). `packages/` holds frontend-only packages. `apps/` holds the deployables. When this tree and the code disagree, the code wins; fix the tree.

```text
apps/
  web-solid/            the SolidJS client
    src/app/            shell, routes, rail, tab strip, top bar, sign-in, session
    src/chat/           transcript, bubbles, attachments, typing, the chat's sidecar
    src/composer/       the message input and its cards
    src/sidebar/        chat list, pinned tiles, the settings sidebar
    src/settings/       settings pages and the settings kit (kit.tsx, kit.css)
    src/files/          the Files tab: tree, viewers, editor
    src/recipes/        the recipe gallery and installs
    src/search/         message search
    src/palette/        the command palette
    src/commands/       hotkeys and command registry
    src/theme/          appearance and imported themes
    src/avatar/         the avatar picker
    src/styles/         motion and token tests
    src/lib/            store, types, helpers
    src/sync/           sockets, stores, optimistic patches, uploads
    src/warm/           IndexedDB
    src/index.css       Tailwind and the global tokens
  server/               the backend Worker
    src/auth/           the access code, the bearer tokens, the dev-only session
    src/user/           UserDO: credentials, memory, reminders, routines
    src/room/           RoomDO: log, burst, delivery, workspace
    src/room/wake.ts    the wake path a routine or a nudge uses to start one agent run
    src/room/signals.ts the signal window: human messages and task changes for routines and the engine
    src/initiative/     open loops wiring: attention (learned moment and appetite), engine, judge
    src/agent/          AgentDO: factory, outbox, kiko's extensions
    src/files/          uploads, downloads, the room file system
    src/recipes/        the recipe catalog and its route
    src/skills/         built-in skills
    src/integrations/   Composio and Kernel
    src/themes/         the Open VSX theme route
    src/lib/            names, dev stats, version
  installer/            the hosted installer Worker: Cloudflare grant, signed install and update
  landing/              the Astro landing page
  cli/                  the kiko verification CLI
packages/
  ui/                   @kiko/ui: Kobalte and Corvu wrappers, icons
  theme/                @kiko/theme: palette, looks, imported VS Code themes
  avatar/               @kiko/avatar: generated avatars
core/
  protocol/             @kiko/protocol: wire types and the protocol version
  durable/              @kiko/durable: alarm, safe-fetch, crypto, migrate, signed releases
  agent/                @kiko/agent: pi-durable host, inbox, effects
  memory/               @kiko/memory: OptMem tree, life log, memory tools, open loops (loops.ts, loop-tool.ts)
  sandbox/              @kiko/sandbox: the recurrence rule for reminders and routines
  extensions/           @kiko/extensions: the parked user-extensions feature, wired by nothing
  browser/              @kiko/browser: browser session and tools
docs/
  overview.md  product.md  architecture.md  self-deploy.md  subagents.md  app-kiko.md
  reference/            code to port, kept unchanged
.cursor/skills/         verification skills
```

## Taste

- Do not use dot separators such as `•` or `·` in interface details. Use labeled rows, chips, or separate elements.
- Prefer deleting to adding. Prefer one code path to two.
- Use Kobalte, Corvu, `@kiko/ui`, and solid-primitives before writing a component.
- Put validation at the edge: the socket, the HTTP route, the tool arguments. Trust types inside.
- Model state as data. A pure function with a table of cases beats scattered conditions.
- Match the kat screenshots in `docs/reference/` exactly. When the replica and the screenshots disagree, the screenshots win.
