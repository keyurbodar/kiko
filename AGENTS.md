# yuki

Yuki is a general-purpose AI chat web app that feels like Telegram. People text one agent or a team of agents. It runs on Cloudflare Workers and Durable Objects, with a SolidJS client. Every user brings their own model keys.

Read `docs/overview.md` before your first task. `docs/architecture.md` has every decision and its reason. Follow it, or change it in the same pull request and say why.

## What makes yuki special

These are not negotiable. A change that breaks one is wrong even if it works.

1. **Instant.** Navigation, buttons, menus, tabs, the composer, and route changes have 0 ms of animation and never wait on the network. The app paints from IndexedDB first.
2. **Optimistic.** Every user action applies locally before the server answers.
3. **Human pacing.** An agent reads a burst of messages together and answers once, in short bubbles.
4. **The human outranks every agent.** A human message is handled first and can interrupt work.
5. **Users never cross.** Only the Worker builds a Durable Object name, always from the session's user id. The one exception is a routine's webhook, which has no session: the Worker uses the user id its D1 row names (architecture D9).
6. **Keys stay on the server.** A credential is encrypted in `UserDO`, never logged, and never sent to the client.
7. **Sentence case.** Interface strings are sentence case, as in monocode and t3code: "Accent color", "Sign out". Names keep their own casing: Yuki, Anthropic, Claude Opus 4.6, Open VSX.

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
- **Wave.** A set of tasks that can run at the same time.
- **Extension.** A user's manifest and script that adds tools, instructions, hooks, or schedules to agents at run time. It runs in QuickJS inside `AgentDO`. Only the human installs one. Architecture section 24.

## Ways to hurt yourself

- **Do not edit `refs/` or `solid-refs/`.** They are read-only references and git ignores them. `pi-durable` is an npm dependency. Extend it through its extension points only.
- **Do not copy code from `solid-refs/tweb`.** It is GPL-3.0. Learn the behavior and write your own.
- **Do not wait on another Durable Object inside `receive()`.** Store, set an alarm, return. Two agents that wait on each other deadlock.
- **Do not do CPU-heavy work in a Worker handler or the queue consumer.** On the Free plan they are stopped at random from about 0.15 s of CPU. Put it in a Durable Object, which has 30 s per request. Architecture section 17.3.
- **Do not fetch the outside from an agent's run except through `egress`.** A run's work belongs to one invocation, and Free allows 50 subrequests per invocation. Model requests and `web_fetch` already go through `AgentDO.egress`.
- **Do not bind one SQL value per item of a list.** A query binds at most 100. Pass the list as one JSON value and read it with `json_each(?)`.
- **Do not use `setTimeout` to schedule work in a Durable Object.** It does not survive eviction and it blocks hibernation. Use `alarm.ts`.
- **Do not write a handler that is unsafe to run twice.** Alarms and queues deliver at least once. Give every delivery and post a stable id.
- **Do not add a tool without an effect.** Every tool declares `read`, `write`, `message`, or `external`.
- **Do not build an agent outside `factory.ts`.** It is the one place that selects extensions.
- **Do not give an extension script a way out except the bridge in `packages/sandbox/src/compile.ts`.** The VM has no I/O by design. A new `yuki.*` power is a manifest permission, a check in the bridge, a line in `describeManifest`, and a test.
- **Do not let anything but the human's socket install an extension.** Agents and the catalog only propose.
- **Do not import `apps/` or `@yuki/protocol` from `packages/durable`, `agent`, `memory`, or `sandbox`.** They are reusable. Pass yuki's behavior in as an option. `scripts/check-imports.ts` fails the build.
- **Do not import Effect, CodeMirror, or a markdown parser into client tiers 1 to 3.** The budget script fails the build.
- **Do not add a model list, a provider adapter, or a Composio tool name.** Those come from `pi-ai` and from Composio at run time.
- **Do not commit a secret.** Keys live in `.dev.vars` and in CI secrets. `OPENCODE_API_KEY` is read from the environment.
- **Do not build** notifications, share links, a terminal, a browser panel, or anything on Convex.

## Dev servers

```bash
bun install
bun dev:server        # the Worker and Durable Objects on localhost:8787 (wrangler dev)
bun dev:web           # the client on localhost:5173, proxying /api to the server
```

Wrangler is already signed in on this machine. Do not run a login step. Use `localhost`, not `127.0.0.1`, for the client.

Several sessions run dev servers at once. Never `pkill` or `killall` wrangler, workerd, or vite: it stops other sessions' servers mid-run. Start yours on a free port (`bun run --cwd apps/server dev --port <n>`, then `bun yuki verify <suite> --url http://localhost:<n>`) and stop only its PID.

Dev keys live in `~/.config/yuki/dev.vars`. Every worktree's `apps/server/.dev.vars` links to it; a git hook adds the link to a new worktree. Never ask the owner to paste a key. The CLI reads keys from the shell: `set -a; . apps/server/.dev.vars; set +a`.

## Verifying

A task is not done until its `Verify` line passes and you have shown the output. Tests alone are not enough.

```bash
bun run typecheck
bun run test                      # every package: client, cli, protocol, server (a bare `bun test` at the root fails)
bun run --cwd apps/server test    # server: one process per file, each boots its own workerd
bun yuki verify --list            # backend suites
bun yuki verify <suite>           # one suite against the dev server
bun yuki verify --no-model        # everything that needs no model key
bun scripts/bundle-budget.ts      # client tier sizes
bun scripts/plan.ts --check       # the plan files are in sync
bun scripts/check-imports.ts      # packages import only the packages below them
```

- Backend work is verified through the yuki CLI, which speaks the same protocol as the client. Add or extend a suite in the same pull request as the feature.
- Frontend work is verified with the `verify-yuki` skill, which drives a real browser. Use it for checks that matter, not for every change.
- Team and loop behavior is tested with fake agents first, so tests are deterministic and cost no tokens.
- Do not write a test that only proves the code runs. A test must fail when the behavior breaks.

## Tasks and pull requests

- The plan is in `docs/phases/`. `tasks.tsv` and `issues/` are generated from it by `bun scripts/plan.ts`. Edit the phase file, then regenerate.
- One task is one session and one pull request. Use the branch name from `tasks.tsv`.
- Start a session with `/task <id>`, or attach the issue file and paste `docs/task-prompt.md`.
- A pull request title starts with the task id. The dependency check greps `main` for it.
- Start a task only when everything it depends on is merged. Work in your own worktree when the task says so.
- Stay inside the files your task names. If you need a file another open task owns, stop and say so.
- If `bun.lock` conflicts, take the base version and run `bun install`.
- Commit messages and pull request descriptions say what changed and why, in plain sentences.

## Documentation rules

- Label a choice the spec did not make as ASSUMPTION, a fact you could not confirm as UNVERIFIED, and a departure from the spec as DEVIATION.
- Never invent an API, a package feature, or a limit. Check `refs/` or the official docs.
- When a task settles an UNVERIFIED item, remove the label in `docs/architecture.md` in the same pull request.
- Write short sentences. No em dashes. Sentence-case headings.

## Where code lives

Directories marked "planned" do not exist until the task in parentheses creates them.

```text
apps/
  web-solid/            the SolidJS client
    src/chat/           transcript, bubbles, attachments, typing
    src/composer/       the message input
    src/sidebar/        chat list and pinned tiles
    src/lib/            store, types, helpers
    src/sync/           sockets, stores, optimistic patches   (planned, P2-06)
    src/warm/           IndexedDB                              (planned, P2-05)
    src/app/            shell, routes, rail, tab strip         (planned, P2-02)
  server/               the Worker                             (planned, P0-01)
    src/user/           UserDO: credentials, memory, reminders
    src/room/           RoomDO: log, burst, delivery, workspace
    src/room/wake.ts    the wake path a routine or a nudge uses to start one agent run
    src/room/signals.ts the signal window: human messages and task changes for routines and the engine
    src/initiative/     open loops wiring: attention (learned moment and appetite), engine, judge
    src/agent/          AgentDO: factory, outbox, yuki's extensions
    catalog/            extensions reviewed upstream, bundled by scripts/gen-catalog.ts
    src/lib/            names, dev stats
  cli/                  the yuki verification CLI              (planned, P0-04)
packages/
  ui/                   @yuki/ui: Kobalte and Corvu wrappers, kat.css
  protocol/             wire types shared by all three apps   (planned, P0-03)
  durable/              @yuki/durable: alarm, safe-fetch, crypto, wipe
  agent/                @yuki/agent: pi-durable host, inbox, effects
  memory/               @yuki/memory: OptMem tree, life log, memory tools, open loops (loops.ts, loop-tool.ts)
  sandbox/              @yuki/sandbox: QuickJS VM, manifest, compiler, checker
docs/
  overview.md  product.md  architecture.md
  phases/               the plan, one file per phase
  research/             facts with sources
  reference/            code to port, kept unchanged
issues/                 one issue per task, by wave (generated)
scripts/plan.ts         generates tasks.tsv and issues/
tasks.tsv               the machine-readable plan (generated)
refs/, solid-refs/      read-only references, not in git
.cursor/skills/         verification skills
```

## Taste

- Prefer deleting to adding. Prefer one code path to two.
- Use Kobalte, Corvu, `@yuki/ui`, and solid-primitives before writing a component.
- Put validation at the edge: the socket, the HTTP route, the tool arguments. Trust types inside.
- Model state as data. A pure function with a table of cases beats scattered conditions.
- Match the kat screenshots in `~/kat-images` exactly. When the replica and the screenshots disagree, the screenshots win.
