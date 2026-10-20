# kiko

Kiko is a general-purpose AI chat web app. People text one agent or a team of agents. It runs on Cloudflare Workers and Durable Objects, with a SolidJS client. Kiko is self-deployed: one Worker serves one owner, who brings their own model keys.

## Principles

1. **Instant.** Navigation, tabs, buttons, and the composer do not animate or wait on the network. The app paints from IndexedDB first. Overlays, toasts, and waiting states may animate, from `styles/motion.css`, which honors `prefers-reduced-motion`. The tool-call panel has no motion, and surfaces separate by tone, never by a border or a ring.
2. **Optimistic.** Every user action applies locally before the server answers.
3. **Human pacing.** An agent reads a burst of messages together and answers once, in short bubbles.
4. **The human outranks every agent.**
5. **One owner per Worker.** Only the Worker builds a Durable Object name, through `apps/server/src/lib/names.ts`, from the session's owner id (`"owner"` in production).
6. **Keys stay on the server.** Credentials are encrypted in `UserDO`, never logged, never sent to the client.
7. **Sentence case.** Interface strings are sentence case. Names keep their own casing: Kiko, Anthropic, Claude Opus 4.6.

## Glossary

- **Room.** A chat with one human and one or more agents. `RoomDO`.
- **Agent.** A room member with its own Durable Object, inbox, and `pi-durable` harness. `AgentDO`.
- **Lead.** The agent that gets untagged messages in a room.
- **Worker.** A background child conversation inside an agent. Not a room member.
- **Burst.** The human messages that arrive before a pause. Delivered together.
- **Run.** The model turns from one input to its final answer.
- **Envelope.** A message as delivered to an agent, with sender, hop count, and root id.
- **Extension.** A user's manifest and script that adds tools, instructions, hooks, or schedules. Runs in QuickJS inside `AgentDO`. Only the human installs one.

## Ways to hurt yourself

- `pi-durable` is an npm dependency. Extend it only through its extension points.
- `receive()` stores and returns; the run happens later.
- Do not do CPU-heavy work in a Worker handler. Put it in a Durable Object.
- Do not fetch the outside from an agent's run except through `AgentDO.egress`.
- Do not bind one SQL value per list item. Pass the list as one JSON value and read it with `json_each(?)`.
- Do not edit or move a table's step in `schema.ts`. Append a new step at the end.
- Do not use `setTimeout` to schedule work in a Durable Object. Use `owner/clock.ts`.
- Make every alarm handler and delivery safe to run twice. Give each one a stable id.
- No code schedules work after an error. Every alarm traces back to a pi task, a routine, a lease or the hello deadline.
- Every tool declares `read`, `write`, `message`, or `external`.
- Build agents only in `factory.ts`.
- An extension script gets no I/O except the bridge in `core/sandbox/src/compile.ts`.
- Only the human's socket installs an extension. Agents and the catalog only propose.
- `core/` and `packages/` must not import `apps/` or `@kiko/protocol`. `scripts/check-imports.ts` enforces this.
- Read `process.env.NODE_ENV` only in `apps/server/src/lib/dev-guard.ts`.
- Do not import Effect, CodeMirror, or a markdown parser into client tiers 1 to 3.
- Do not hard-code a model list, a provider adapter, or a Composio tool name. They come from `pi-ai` and Composio at run time.
- Do not commit a secret. Keys live in `.dev.vars` and CI secrets.
- Do not build notifications, share links, a terminal, a browser panel, or anything on Convex.
- Do not add a second owner. No sign-up, no accounts for other people, no account database.

## Dev servers

```bash
bun install
bun dev:server        # the Worker and Durable Objects on localhost:8787
bun dev:web           # the client on localhost:5173, proxying /api to the server
```

Use `localhost`, not `127.0.0.1`. Keys for local runs live in `~/.config/kiko/dev.vars`, linked from `apps/server/.dev.vars`. Never print a key. The dev-only route `/api/auth/dev/session?name=<name>` returns a bearer token for a named dev owner, in a development build on a local host only.

Several sessions run dev servers at once. Never `pkill` or `killall` wrangler, workerd, or vite. Start your own server on a free port and stop only its PID.

## Checks

```bash
bun run check                                   # typecheck, lint, imports, rules, exports, tests; cached, so a rerun is fast
bun run --cwd apps/server test                  # server tests only, one process per file
bun kiko verify --list                          # backend suites
bun kiko verify <suite> --url http://localhost:<n>
bun scripts/bundle-budget.ts                    # client tier sizes
```

Run only the tests and suites your change touches. CI runs the full gate and every model-free suite on each push, so a full local run repeats it. Frontend behavior is checked in a real browser with the `verify-kiko` skill in `.cursor/skills/`.

A test must fail when the behavior breaks. A test that only proves the code runs does not count.

## Code style

- Delete before adding. Prefer one code path to two.
- Validate at the edge: the socket, the HTTP route, the tool arguments. Trust types inside.
- Use Kobalte, Corvu, `@kiko/ui`, and solid-primitives before writing a component.
- Do not use dot separators such as `•` or `·` in interface details.

## Pull requests

- One change is one pull request.
- Commit messages and pull request descriptions say what changed and why, in plain sentences.
- If `bun.lock` conflicts, take the base version and run `bun install`.
