# Phase 17. A cloud browser through Kernel

The owner asked for this on 2026-10-10. Agents get a real browser for pages that need JavaScript, a login, or clicks. Kernel runs the browser. Each user brings their own Kernel key, exactly as with Composio. A user without a key has no browser tools, and nothing else changes.

Phase 16 is taken by the initiative work on the `proactiveness` branch, so this phase is 17.

## The decisions

These go into a new architecture section 26 in P17-01. Each task fills in its part.

### One broker per user, inside `UserDO`

The Kernel key is sealed in `UserDO`, and every Kernel call is made from there, the same way `composioCall` works today. `AgentDO` never holds the key. It asks `UserDO` to act for it over RPC.

The broker also owns what several agents share. It keeps a lease table, enforces the concurrency cap, holds the profile lock, and reaps idle sessions on an alarm. All of this is one user's state, so it belongs in the one object that is already per user. No new Durable Object class and no migration are needed.

### One browser per agent, never shared

Kernel's own skills say one browser per worker. Two agents driving one page would fight over focus and refs. So a lease is keyed by agent id. The lead and each team member get their own session when they first browse. Subagents (helpers) do not get browser tools in this phase. `browser` joins `NOT_FOR_HELPERS`. A helper that needs a page asks its parent.

When the user is at the cap, the tool does not wait. It returns at once with "Browser busy. Held by Mira (reading github.com) and Juno (checkout form)." The agent can `ask` that agent instead. This follows the rule that nothing waits on another object inside a run step.

### Fetch only, no WebSocket, no SDK

Every Kernel call is plain REST over `fetch`. The live probe on 2026-10-10 used four endpoints and all worked:

| Call | Endpoint | Measured |
|---|---|---|
| Create a headless session | `POST /browsers` | 1.4 s |
| Run Playwright on Kernel's side | `POST /browsers/{id}/playwright/execute` | 1.1 to 7.0 s |
| Screenshot as PNG | `POST /browsers/{id}/computer/screenshot` | 1.2 s, 15 KB |
| Delete | `DELETE /browsers/{id}` | 0.7 s, 204, then 404 on get |

CDP needs a long-lived WebSocket and `playwright-core`, which a Durable Object should not hold. `@onkernel/sdk` uses `fetch` and has no runtime dependencies, but nothing confirms it runs in Workers (UNVERIFIED). Four endpoints do not justify a dependency. We write a 60-line client.

### Spend nothing that the task does not need

Kernel bills headless time at about $0.06 an hour and headful at about $0.48 an hour. A session goes into standby 5 s after its last request, and standby costs nothing. So idle time is free, but a held session still takes one of the user's concurrent slots (5 on Kernel's free plan).

The real costs are model tokens, subrequests, and slots. Each rule below targets one of them.

| Rule | Value | Why |
|---|---|---|
| Default mode | headless, no stealth | 8x cheaper than headful. Stealth adds a proxy. |
| Headful | only for a human login | Live view needs it. Nothing else does. |
| Stealth | only when the agent asks after a block | It is set at create, so a retry makes a new session. |
| Warm window | 5 min after the last call | A human reply inside 5 min reuses the page for free. |
| Hard lifetime | 20 min | A stuck run cannot hold a slot forever. |
| Kernel `timeout_seconds` | 360 | Kernel's own net if our reaper misses. |
| Yuki's cap | 3 sessions per user, user can raise it | Leaves room under Kernel's cap of 5. |
| Execute timeout | 45 s per call | Keeps one call well inside a run step. |
| Snapshot text | 6,000 characters, with `more` to page | A full aria tree of Wikipedia was 214 KB. |
| Refs per snapshot | 60, in the viewport first | 104 refs on Hacker News is too many to read. |
| Screenshots | PNG from `/computer/screenshot`, only on request, only for a model that sees images | 15 KB PNG beats 50 KB of base64 JPEG. |

Every lease ends in a delete. The reaper runs on `alarm.ts`, deletes are idempotent (404 counts as done), and account wipe deletes every session. Example cost of a five-step task, measured at about 15 s of active time: under $0.001.

### What the model sees

The probe compared three ways to show a page.

| Shape | Hacker News | Wikipedia article |
|---|---|---|
| Full aria snapshot | 43.6 KB | 214 KB |
| `innerText` | 4.7 KB | 70 KB |
| Interactive refs | 4.8 KB, 104 refs | not measured |

So the snapshot is the page title, the URL, up to 60 refs, and the main text cut to the budget. A ref looks like `e12 link "new"`. One execute call tags each element with `data-yuki-ref`, which survives between calls (measured). Refs go stale on navigation, so every action returns a fresh snapshot. After an action, the snapshot lists only what changed when the page did not navigate.

### Three tools

| Tool | Effect | Does |
|---|---|---|
| `browse` | `read`, outside `web` | Open a URL or read the current page. Returns a snapshot. Optional `more`, `stealth`. |
| `browser_act` | `external` | Run up to 10 steps in one call: `click`, `fill`, `select`, `press`, `scroll`, `wait`, `back`. Returns a snapshot. |
| `browser_look` | `read`, outside `web` | A PNG screenshot for a model that sees images. |

`browse` taints the run, like `web_fetch`. `browser_act` is `external`, so the trust gate asks the human in a routine run or a run another agent started. A human-started run acts without asking, as with every other `external` tool. There is no free-form Playwright tool. Arbitrary code would make the effect unknowable, and batching steps already gives one subrequest per action.

The tool returns refs and text only. A URL the agent opens must be `https:` or `http:`. The browser runs on Kernel's network, so our private-address checks do not apply and are not needed.

### What the agent is told

The browser extension adds a short instruction block.

- Use `web_fetch` first. Use `browse` only when the page needs JavaScript, a login, or a click.
- Batch the steps you already know into one `browser_act`.
- Ask for a screenshot only when the layout matters.
- Never type a password, a card number, or a one-time code. Ask the human to log in.
- If the browser is busy, ask the agent that holds it.

### Logins by human handoff

An agent that hits a login calls `browser_login(site)`. The broker opens a headful session on the user's Kernel profile with `save_changes: true` and posts a card in the room: "Mira needs you to sign in to github.com. Open browser." The link opens Kernel's live view in a new tab. It is not an embedded panel, so the rule against a browser panel holds. The human signs in and taps Done. The broker deletes the session, and Kernel saves the profile on delete.

Every later session attaches the profile read-only, so every agent is signed in. Only one session at a time may write the profile, because Kernel does not merge concurrent saves. The broker's profile lock enforces that.

Kernel's managed auth can log in and re-authenticate on its own. Its REST paths are not in the skills we have, and it stores the user's password with Kernel. It is a later phase, after a prototype.

## Tasks

### P17-01 Kernel key in Settings

`deps: none` `difficulty: 2` `area: backend` `parallel: yes`

**Verify.** `bun yuki verify kernel-key` passes with `KERNEL_API_KEY` set. A bad key is refused and nothing is stored. A good key is stored, the reply says connected, and the key never appears in any frame sent to the client. Disconnect clears it.

**Goal.** A user can paste a Kernel key in Settings, Integrations, and Yuki checks it and keeps it sealed.

**Files.** `apps/server/src/integrations/kernel/store.ts`, `kernel/client.ts`, `user/user-do.ts`, `packages/protocol/src/user.ts`, `schema.ts`, `apps/web-solid/src/settings/integrations.tsx`, `integrations-client.ts`, `apps/cli/src/commands/kernel.ts`, `apps/cli/src/verify/suites/kernel-key.ts`, `docs/architecture.md`.

**Build.**

- `KernelStore` copies `ComposioStore`. A `kernel` table, the key sealed with AAD `kernel/key`, re-seal on a new KEK, and a generation counter so a late write after clear is dropped.
- `client.ts` is the fetch client for `https://api.onkernel.com` with `Authorization: Bearer`. It has create, execute, screenshot, delete, and list. 429 and 529 return a typed busy error with `Retry-After`.
- Connecting checks the key with `GET /browsers?status=active`. Only a 200 stores it.
- Frames `connectKernel` and `disconnectKernel`, and status in the integrations listing. The reply has status only.
- A `KeyField` below Composio with the placeholder `sk_...` and the label "Kernel browser".
- Write architecture section 26 from this phase's decisions.

### P17-02 Browser broker in UserDO

`deps: P17-01` `difficulty: 4` `area: backend` `parallel: no`

**Verify.** `bun run --cwd apps/server test test/kernel-broker.test.ts` passes, and `bun yuki verify browser-broker` passes with a real key. Two agents get two sessions. The third agent past a cap of 2 gets a busy answer naming the holders, at once. A lease idle past 5 min is deleted by the alarm. At the end, Kernel's active list is empty.

**Goal.** One place per user decides which agent holds which session, and every session ends.

**Files.** `apps/server/src/integrations/kernel/broker.ts`, `kernel/snapshot.ts`, `user/user-do.ts`, `apps/server/test/kernel-broker.test.ts`, `apps/cli/src/verify/suites/browser-broker.ts`.

**Build.**

- A `leases` table with agent id, session id, mode, last use, created, and what the agent last opened. The budget values are one exported table, not constants scattered in code.
- `browserCall(agentId, request)` is the one RPC. It finds or creates the lease, runs the request, stamps last use, and returns a snapshot or a typed error. A create carries a stable id, so a retried call reuses the session.
- `snapshot.ts` holds the Playwright source that tags refs and cuts text, as a string constant. The tagging runs in one `page.evaluate`, because the probe's per-element version took 7 s.
- The reaper is a wakeup in `alarm.ts`. It deletes past the warm window or the hard lifetime. A 404 on delete counts as done. Account wipe deletes every lease.
- A dev counter `kernel.<call>.ms` per Kernel call, read by the suite.

### P17-03 Browser tools for agents

`deps: P17-02` `difficulty: 4` `area: backend` `parallel: no`

**Verify.** `bun yuki verify browser --fake` passes with no model key. A scripted agent browses, acts in one batch, and gets a fresh snapshot. A routine run's `browser_act` raises an approval card. A helper has no browser tools. Then `bun yuki verify browser` with real keys passes. An agent asked for the top story on Hacker News answers correctly in under 60 s, using no more than 4 Kernel calls, with no screenshot.

**Goal.** Every agent in a room with a Kernel key can read and act on real pages, cheaply.

**Files.** `apps/server/src/agent/extensions/browser.ts`, `agent/factory.ts`, `agent/agent-do.ts`, `agent/extensions/subagent.ts`, `apps/server/test/browser-tools.test.ts`, `apps/cli/src/verify/suites/browser.ts`.

**Build.**

- `browserExtension` registers `browse`, `browser_act`, and `browser_look` with the effects in the table above. It calls `userStub.browserCall`. The factory adds it only when the user has a key, the way Composio is added.
- The instruction block from "What the agent is told".
- `browser` joins `NOT_FOR_HELPERS`.
- `browser_look` returns an image block only when the model accepts images. Otherwise it returns "This model cannot see images."
- The busy error names the holders, so the agent can `ask` one of them.
- When a run ends, the agent tells the broker to stamp last use. It does not delete. The warm window covers a quick reply.

### P17-04 Browser sessions in Settings

`deps: P17-02` `difficulty: 2` `area: frontend` `parallel: yes`

**Verify.** With the `verify-yuki` skill, Settings, Integrations shows each live session with its agent, the site, and how long it has been open. "Close" ends one, and Kernel's active list drops it. The cap field saves at once, before the server answers.

**Goal.** The human sees what is running and can stop it.

**Files.** `apps/web-solid/src/settings/integrations.tsx`, `integrations-client.ts`, `packages/protocol/src/user.ts`, `schema.ts`, `apps/server/src/user/user-do.ts`.

**Build.**

- A `browserSessions` frame lists leases. A `closeBrowser` frame ends one, and a `browserCap` frame sets the cap from 1 to 10.
- The list patches optimistically on close.
- Strings are sentence case: "Browser sessions", "Close", "At most 3 at a time".

### P17-05 Logins by human handoff

`deps: P17-03` `difficulty: 4` `area: backend` `parallel: no` `human: yes`

**Verify.** `bun yuki verify browser-login` passes with a human step. The agent calls `browser_login("github.com")`, the room shows the card, the human signs in through live view and taps Done, and a new headless session then opens a signed-in page. A second login while one is open is refused. The `verify-yuki` skill shows the card and the link.

**Goal.** A user signs in once in Kernel's live view, and every agent is signed in after that.

**Files.** `apps/server/src/integrations/kernel/broker.ts`, `kernel/profile.ts`, `agent/extensions/browser.ts`, `room/room-do.ts`, `packages/protocol/src/room.ts`, `apps/web-solid/src/chat/LoginCard.tsx`, `app/routes/chat.tsx`, `apps/cli/src/verify/suites/browser-login.ts`.

**Build.**

- One Kernel profile per user, created on first login and named from the user id by the Worker.
- `browser_login(site)` is a `message` tool. It ends the agent's own lease, takes the profile lock, opens a headful session with `save_changes: true`, and posts the card through the room.
- The card holds the live view link and a Done button. Done, or 15 min, deletes the session and frees the lock. The agent gets a delivery: "Signed in to github.com."
- Every other session attaches the profile with `save_changes: false`.
