# Phase 17. A fast, cheap browser with Kernel and Jev

The owner asked for this on 2026-10-10. Agents get a real browser for pages that need JavaScript, a login, or clicks. Kernel runs the browser. A small worker loop takes the browser steps, so the main model plans instead of clicking. The human can watch any browser or take it over at any time.

A user brings a Kernel key in Settings, as with Composio. A user without a Kernel key has no browser tools. Jev is optional. With no TypeSafe key, the worker loop asks the agent's own model in a compact prompt. With one, Jev makes the step choice faster and cheaper. Both paths have the same tools and the same loop.

Phase 16 is taken by the initiative work on the `proactiveness` branch, so this phase is 17. Every number below was measured against the live APIs on 2026-10-10, unless it says UNVERIFIED.

## The strategy in one paragraph

Each user gets one Kernel browser on their own key. It is headless by default and becomes headful only when the human presses Watch or Take over, or an agent calls `browser_share`. A switch makes a new browser, so logins live in a per-user Kernel profile that every browser saves. Each agent drives its own tab over a raw CDP WebSocket, at about 200 ms a command instead of 1 to 2 s a call through Kernel's execute endpoint. One script reads the page in one call. Code cuts the page to about 35 choices. A decider picks the next step. The decider is the agent's own model by default, or Jev when the user has a TypeSafe key, for about $0.00005 and 300 ms. The main model plans, writes the values to type, and reads only the short result. Parallel work is several workers on several tabs of the same browser. The live view link goes only to the human, through a button, never through a model.

## The decisions

These become architecture section 27 in P17-01. Each task fills in its part.

### One browser per user, one tab per agent

Every limit and every cent here is the user's own. Each user's browsers run on their own Kernel key and account, and yuki has no Kernel account of its own. A tab is free. A browser costs a create (0.25 to 0.75 s), one of the user's Kernel slots, and one of Kernel's 10 creates per minute. So the user's agents share one browser, and each agent works in its own tabs.

Sharing one browser also settles three other problems. Each tab gets `Emulation.setFocusEmulationEnabled` so Chrome does not throttle it in the background, and nothing ever calls `Page.bringToFront`, so agents never steal focus from each other. Every agent sees the same logins, because they share one profile. Only one browser writes the profile, and Kernel does not merge concurrent saves, so there is never a second writer. And the human has one live view that shows every agent's work.

A browser holds at most 8 tabs. Past that, the tool answers at once with who holds the tabs, and the agent can `ask` one of them. Nothing waits.

### Headless by default, headful on demand

Headless costs $0.06 an hour of active time and headful $0.48. Live view exists only for a headful browser, and a browser cannot change mode after create. PATCH with `headless: false` returned 200 and changed nothing. So the browser starts headless and is replaced by a headful one on demand.

A switch happens when the human presses Watch or Take over, or an agent calls `browser_share`. The broker deletes the headless browser, which saves the profile, then creates a headful one on the same profile and reopens each tab's URL. Page state that is not in the profile, like a half-filled form, is lost. The tool says so. The browser stays headful until the warm window ends, then the next browser is headless again.

An open CDP socket counts as activity to Kernel. So an agent closes its socket 15 s after its last browser call. Reconnecting costs about 1.3 s, measured.

### Logins live in a per-user profile

Every browser a user gets, headless or headful, attaches the user's one Kernel profile with `save_changes: true`. Kernel saves the profile when the browser is deleted, by us or by its own timeout. So a login survives the warm window, a mode switch, and a restart.

There is never more than one browser per user at a time. That makes the browser the only writer of the profile, and Kernel does not merge concurrent saves. A switch deletes the old browser before it creates the new one.


### Where each piece runs

| Piece | Runs in | Why |
|---|---|---|
| Kernel key, profile, browser lifecycle, live view and CDP URLs | `UserDO` | Keys stay in `UserDO`. One owner per user browser. |
| CDP socket, tabs, page reading, actions | `AgentDO`, during a run | The run already lives there. No new Durable Object class. |
| Jev calls | `AgentDO.egress` through pi-ai `classify` | Same path as every model request. |

`UserDO` hands an agent the CDP URL over RPC. The URL is a bearer capability for the life of the browser, so it is sealed at rest and never logged or shown to a model. The Kernel key never leaves `UserDO`.

DEVIATION from the Composio pattern, where `UserDO` makes every call. CDP needs a socket held by the object that runs the loop, and the loop is the agent's.

### Proof that a Durable Object can hold the socket

A spike on 2026-10-10 ran a Durable Object under `wrangler dev` against a real Kernel browser. `new WebSocket(cdp_ws_url)` connected in 861 ms. Two tabs were created, attached with flat sessions, and given focus emulation in about 1 s. Hacker News and Wikipedia loaded in parallel in 1.8 s of wall time. A second CDP client on the same browser was allowed and saw the first client's tabs, so two agents can share one browser. There were no CPU or subrequest warnings. The spike ran on local workerd. Production behavior is UNVERIFIED until P17-02's suite runs against a deployed Worker.

One detail matters. The wait for `Page.loadEventFired` must be registered before `Page.navigate`, because the event can arrive first.

### Packages

| Package | Use | Note |
|---|---|---|
| `devtools-protocol` | Types for the CDP client | Types only, no runtime code. |
| `effect` 4.0.0 | The CDP session as a scoped resource with timeouts and interruption | Already pinned in the server. Not in client tiers. |
| `@onkernel/sdk` | Kernel REST calls in `UserDO` | No dependencies. Its README lists Cloudflare Workers. P17-01 keeps it only if the server bundle grows by less than 50 KB gzipped. Otherwise a 5-endpoint fetch client replaces it. |

Not used: Stagehand and Playwright. Stagehand 4 imports `node:fs`, `node:net`, and `node:child_process`, and Playwright needs Node. We take their ideas, not their code.

The CDP client is a new package, `packages/cdp` (`@yuki/cdp`). It knows nothing about yuki. It holds the socket, the tabs, the page script, and the actions. It must not import `apps/` or `@yuki/protocol`.

### How a page is read

One `Runtime.evaluate` of our page script returns the page. Reading `innerText` alone took 200 ms. A naive scan of 231 controls on a loaded Hacker News page took 1.2 s, so the scan must be written for speed, and P17-02 fails above 400 ms at p50. The ideas come from jev-ultrafast (MIT) and Stagehand. We write our own code.

- Visible controls only: links, buttons, inputs, selects, text areas, summaries, editable regions, and common ARIA roles. Password, file, and hidden inputs are left out.
- Each control has a short integer id, role, label, value, and state. The id is kept on the element, so it survives between calls.
- Each control carries a position hint built from its block, such as "story 3, comments". The hint raised Jev's confidence on "open the comments of the 3rd story" from 0.29 to 0.99.
- Text is cut to 6,000 characters. Elements are capped at 250.
- A page key and a per-element guard say whether the page changed. An action checks the guard first. If the page moved, the agent reads it again instead of clicking the wrong thing.

The full accessibility tree is never sent to anyone. It was 619 KB for Hacker News.

### How a step is chosen

One worker loop takes the steps. A decider makes each choice. The default decider is the agent's own model with a compact prompt, at most about 1,200 tokens, one line out. The Jev decider is used when the user has a TypeSafe key. Both get the same choices and follow the same hand-back table. Everything below about Jev's cost applies only to the Jev decider.

Jev bills every question for the full state, measured. Five questions cost 2.8 times one. So a step is one Choice question, not one per operation.

- Code first cuts the candidates to about 35. It keeps the navigation links and the 25 best word matches to the goal. When nothing matches, as on a page in another language, it keeps the first 35 in reading order.
- Each option is an operation on a target, like `click 7 link "new" (top nav)` or `type "query" into 3 input "Search"`. `scroll down`, `done`, and `stuck` are options too.
- The question's state is the goal, the value names, the last 3 actions, the URL, and the title. Page text is not sent. It cost 40% more tokens and helped only where the position hint already helps.

Measured on Hacker News: 875 to 1,060 input tokens, 285 to 315 ms at p50, 5 of 5 correct, $0.000045 a decision.

Jev never writes text. The main model passes named values with the task, such as `query: "kernel browser pricing"`, and Jev picks which field gets which value. A worker that needs a value it was not given stops and asks the main model.

### When Jev hands back to the main model

| Situation | What happens |
|---|---|
| Jev's confidence is under 0.6, or the model answers `unsure` | Stop. Return the top 3 options and the page summary to the main model. |
| Jev picks `stuck`, or 3 actions leave the page unchanged | Stop with the page summary. |
| Jev picks `done` | Stop. The main model checks the result. A Noul "is the goal done" check scored 0.85 on a page where the goal was not done, so it is not used. |
| A password field, a payment form, or a one-time code | Stop. Ask the human to take over. |
| 30 steps | Stop. |

The thresholds are one exported table. The `browser-jev` suite sets them from real runs.

### Parallel work

`browser_run` takes up to 4 tasks, with or without Jev. Each task gets a worker with its own tab, and the workers run at the same time over the agent's one socket. The tool returns when all of them stop. Jev handled 20 requests at once with no 429 and a p50 of 400 ms. Kernel ran three tabs' work in parallel.

A worker step costs about one Jev call, one action, and one page read. That is about 0.8 to 1.1 s. A step taken by the main model costs a full turn.

`browse` also takes up to 4 URLs. It opens them in parallel tabs and returns the passages relevant to `find`, ranked by Jev. Reading needs no worker loop.

### The tools

| Tool | Effect | Does |
|---|---|---|
| `browse` | `read`, outside `web` | Open up to 4 URLs, or read the agent's current tab. With `find`, return only the relevant passages, at most 1,500 characters. Otherwise return the page summary. |
| `browser_act` | `external` | Up to 10 steps on the agent's tab, by id: `click`, `type`, `select`, `press`, `scroll`, `back`. Returns the page summary. |
| `browser_run` | `external` | Up to 4 workers, each with a goal, an optional URL, and named values. Uses Jev when the user has a TypeSafe key, otherwise the agent's own model. |
| `browser_look` | `read`, outside `web` | A JPEG of the agent's tab, about 50 KB, for a model that sees images. |
| `browser_share` | `message` | Ask the human in plain chat to watch or take over, with a reason. |

`browse`, `browser_act`, and `browser_run` run like every tool, with no gate (section 16). `browse` and `browser_look` declare `read`; `browser_act` and `browser_run` declare `external`, so the effect stays truthful.

Helpers do not get browser tools. `browser` joins `NOT_FOR_HELPERS`. Parallel browsing is `browser_run`, which is cheaper than a helper because it runs no model.

### What the main model sees

The main model's tokens cost far more than Jev's. So the main model reads a summary, not the page.

- The page summary is the title, the URL, at most 40 controls as `7 link "new"`, and at most 1,500 characters of text.
- A worker returns its stop reason, the last URL, its last 5 actions, and, when asked, passages for `find`.
- Page text reaches the model wrapped as untrusted, like every outside result.

The extension adds a short instruction block.

- Use `web_fetch` first. Use the browser only when the page needs JavaScript, a login, or clicks.
- Give `browser_run` whole goals and the values to type. Do not drive step by step when a worker can.
- Use `browser_look` only when the layout matters.
- Never type a password, a card number, or a code. Ask the human to take over.

### Watch and take over

The room shows a browser chip whenever one of its agents holds a tab. The chip has two buttons.

- **Watch** opens live view with `readOnly=true` in a new tab. Agents keep working.
- **Take over** sets a takeover flag in `UserDO` first, then opens live view with control. While the flag is set, every browser tool returns "The human is using the browser" and every worker pauses before its next action. "Hand back" clears it. The human outranks every agent.

The button asks `UserDO` for the link over the user socket. The link is not stored in the room log, and no model ever sees it. Live view opens in a new tab. It is not an embedded panel, so the rule against a browser panel holds.

A login is a takeover. The agent calls `browser_share` with "Please sign in to github.com", the human takes over, signs in, and hands back. The cookies live in the shared profile, so every agent is signed in. Kernel saves the profile when the browser is deleted.

### Lifecycle and budgets

| Rule | Value | Why |
|---|---|---|
| Create | lazily, on the first browser call | A user who never browses pays nothing. |
| Warm window | 5 min after the last call, then delete | Standby is free, but the browser holds a slot. |
| Hard lifetime | 30 min, unless the human is taking over | A stuck run cannot hold a slot. |
| Kernel `timeout_seconds` | 600 | Kernel's own net if our reaper misses. |
| CDP socket idle close | 15 s | An open socket counts as activity. |
| Tabs per browser | 8 | Kernel runs at most 8 executors in parallel. |
| Workers per `browser_run` | 4 | |
| Steps per worker | 30 | |
| Settle after an action | 2 animation frames or 50 ms, up to 200 ms for a menu | jev-ultrafast's measured setting. |

The reaper is a wakeup in `alarm.ts`. Every delete is idempotent, and a 404 counts as done. Account wipe deletes the browser and the profile.

### Failures

| Failure | Handling |
|---|---|
| Two agents ask for a browser at once | `UserDO` creates once. The lease row has a stable id, and the second caller gets the same browser. |
| The browser died or timed out | The socket closes. `UserDO` marks the lease dead. The next call creates a new browser and reopens each tab's last URL. The tool says "The browser restarted". |
| Kernel 429 on create | Respect `Retry-After` once, then return busy. |
| Kernel 529 | Retry once, then return "Kernel is out of capacity". |
| Kernel 401 | Mark the key broken. Settings shows it, and the tools leave on the next build through `stale()`. |
| A page opens a new tab | Attach it and give it to the agent that opened it. |
| `alert` or `beforeunload` | Accept it. `confirm` or `prompt` stops the worker and returns to the main model. |
| Cross-origin iframes and closed shadow roots | Not read in this phase. `browser_look` and the main model cover them. |
| File upload and download | Not in this phase. Kernel's file endpoints are UNVERIFIED. |
| The Durable Object is evicted mid-run | The socket is lost. The next call reconnects from the sealed lease. |
| The human takes over mid-step | The worker sees the flag before its next action and pauses. |

### What a task costs

A typical 12-step task on one site, using the measured numbers:

| Part | Cost |
|---|---|
| Jev, 12 decisions at about 1,000 tokens | $0.0005 |
| Kernel headless, about 15 s of active time | $0.0003 |
| Main model | 2 turns instead of about 12 |

The main model's turns dominate the bill. The worker loop's job is to remove them. Without Jev, each worker step costs a short model call instead of a full turn.

## Later, if measurements ask for it

A replay cache, as in Stagehand, would remember a site's step by host, goal, and control label, and replay it with no Jev call. Build it only if the `browser-jev` suite shows repeated routines spending real Jev time. Kernel's managed auth could replace the human sign-in, but its REST paths are not in the skills we have. Browser pools are plan-gated and were no faster to acquire than a plain create.

## Tasks

### P17-01 Kernel key and the user's browser

`deps: none` `difficulty: 3` `area: backend` `parallel: yes`

**Verify.** `bun yuki verify kernel` passes with `KERNEL_API_KEY` set. A bad key is refused and nothing is stored. Two agents asking at once get the same browser, headless. A cookie set before the reaper deletes the browser is still there in the next browser, and still there after a switch to headful and back. The reaper deletes it after the warm window. Account wipe deletes it. At the end, Kernel's active list is empty. No frame sent to the client contains the key or a CDP URL.

**Goal.** A user pastes a Kernel key, and `UserDO` can lease the user's one browser to any of their agents, headless by default and headful on demand, with logins kept in the user's profile.

**Files.** `apps/server/src/integrations/kernel/`, `user/user-do.ts`, `packages/protocol/src/user.ts`, `schema.ts`, `apps/web-solid/src/settings/integrations.tsx`, `integrations-client.ts`, `apps/cli/src/commands/kernel.ts`, `apps/cli/src/verify/suites/kernel.ts`, `apps/server/test/kernel-lease.test.ts`, `docs/architecture.md`.

**Build.**

- `KernelStore` copies `ComposioStore`. It seals the key with AAD `kernel/key`, and the lease's CDP and live view URLs with `kernel/lease`.
- Measure the bundle with and without `@onkernel/sdk`. Keep the SDK only if it adds less than 50 KB gzipped. Record the number in section 27.
- `leaseBrowser(agentId)` creates once, with `headless: true`, `timeout_seconds: 600`, and the user's profile with `save_changes: true`. `switchMode(mode)` deletes the browser, then creates one in the other mode on the same profile, and returns the tabs' URLs to reopen. It returns the CDP URL. `releaseTabs(agentId)` stamps last use.
- The reaper, wipe, 401, 429, and 529 behave as in the tables above.
- Connecting checks the key with `GET /browsers?status=active`. Only a 200 stores it.
- A `KeyField` labeled "Kernel browser" below Composio, with the placeholder `sk_...`.
- Write architecture section 27 from this phase's decisions.

### P17-02 A CDP client that reads and acts on a page

`deps: none` `difficulty: 4` `area: backend` `parallel: yes`

**Verify.** `bun run --cwd packages/cdp test` passes against a scripted fake CDP server. `bun yuki verify browser-cdp` passes against a real Kernel browser from a Durable Object under `wrangler dev`. Two tabs load two sites in parallel. The page read returns ids and position hints. A click by id lands. A stale id is refused. Each step's time is printed, and a read must be under 400 ms at p50.

**Goal.** `@yuki/cdp` gives a Durable Object a fast, typed handle on browser tabs.

**Files.** `packages/cdp/` (new), `scripts/check-imports.ts`, `apps/server/src/agent/dev-browser.ts`, `apps/cli/src/verify/suites/browser-cdp.ts`.

**Build.**

- A CDP session on Effect 4. It is a scoped resource over one WebSocket, with a timeout per command and flat sessions per tab. Commands are typed from `devtools-protocol`.
- `openTab`, `closeTab`, and focus emulation, so background tabs keep rendering.
- The page script from "How a page is read", as a string constant, and `read(tab)`.
- `act(tab, step)` for click, type, select, press, scroll, and back. Clicks are real mouse events at the element's center after a fresh guard and geometry check. Typing is select-all, then `Input.insertText`. Then it settles as in the table.
- Popups and dialogs as in the failures table.
- `check-imports.ts` puts `packages/cdp` beside `packages/durable`.

### P17-03 Browser tools for agents

`deps: P17-01, P17-02` `difficulty: 4` `area: backend` `parallel: no`

**Verify.** `bun yuki verify browser --fake` passes with no model key. A scripted agent browses, acts in one batch, and reads a fresh summary. A routine's `browser_act` runs. A helper has no browser tools. The ninth tab gets a busy answer naming the holders. Then `bun yuki verify browser` passes with real keys. An agent asked for the top story on Hacker News answers correctly in under 20 s, with no screenshot and its socket closed 15 s later.

**Goal.** Every agent of a user with a Kernel key can read and act on real pages.

**Files.** `apps/server/src/agent/extensions/browser.ts`, `agent/factory.ts`, `agent/agent-do.ts`, `agent/extensions/subagent.ts`, `apps/server/test/browser-tools.test.ts`, `apps/cli/src/verify/suites/browser.ts`.

**Build.**

- `browse`, `browser_act`, and `browser_look`, with the effects in the table. Each agent's tabs belong to it.
- The page summary from "What the main model sees". Without Jev, `find` ranks passages by word overlap.
- The instruction block.
- The idle socket close, as a wakeup in `alarm.ts`, not `setTimeout`.
- `browser` joins `NOT_FOR_HELPERS`.
- The factory adds the extension only when the user has a Kernel key, the way Composio is added.

### P17-04 Workers with the model or Jev

`deps: P17-03` `difficulty: 4` `area: backend` `parallel: no`

**Verify.** `bun yuki verify browser-run` passes twice with real keys, once with only Kernel and OpenCode Go, once with a TypeSafe key added. Each time, one `browser_run` with 3 tasks on 3 sites finishes all 3 at once, and main-model turns per task are at most 2. The suite prints and checks p50 step time, under 1.2 s with Jev and under 2.5 s without, and p50 Jev input tokens per decision under 1,500. A forced low-confidence page hands back with the top 3 options. A login page stops and asks for a takeover.

**Goal.** A worker takes the clicks, the main model plans, and parallel tasks run at once. Jev is used only when the user has a TypeSafe key.

**Files.** `apps/server/src/agent/extensions/browser.ts`, `agent/browser-worker.ts`, `apps/server/test/browser-worker.test.ts`, `apps/cli/src/verify/suites/browser-jev.ts`.

**Build.**

- The candidate cut, the single Choice, value selection, and the hand-back table from "How a step is chosen". The question text is a constant, and so are the thresholds.
- `browser_run` with up to 4 workers, one tab each, sharing the agent's socket.
- Jev ranks `browse` passages for `find`, with one Noul a passage, about 20 passages in one request.
- Confirm that pi-ai `classify` returns per-option probabilities and confidence for a Choice. If it does not, call `POST https://api.typesafe.ai/v1/systemone` through egress, and record the DEVIATION.
- Settled on 2026-10-10: pi-ai `classify` answers a `choice` question with `choice`, `probabilities`, and `confidence`, and takes a `fetch` option. Jev goes through `classify` with `AgentDO.egress` as that fetch. No direct System One call.
- DEVIATION: the code lives in `apps/server/src/agent/browser/` (`connection.ts`, `lease.ts`, `deciders.ts`, `tools.ts`) instead of `extensions/browser.ts` and `browser-worker.ts`. The worker loop itself is `@yuki/browser`'s `runTasks`.
- DEVIATION: Muse Spark 1.3 thinks about 100 to 170 tokens even at minimal reasoning, so the model decider allows 256 output tokens. With 24 it returned no answer.
- Measured on 2026-10-10 from a laptop whose CDP round trip to Kernel was 350 to 400 ms, not the 200 ms above: a worker step took about 3.2 s with the model decider (decision 2.0 s) and 2.1 s with Jev (decision 0.2 s, about 1,260 input tokens). The step targets are UNVERIFIED until the suite runs nearer Kernel.
- Each worker checks the takeover flag before each action.

### P17-05 Watch and take over

`deps: P17-03` `difficulty: 3` `area: frontend` `parallel: yes` `human: yes`

**Verify.** With the `verify-yuki` skill, a room whose agent holds a tab shows the browser chip. Watch opens a read-only live view, and the agent keeps working. Take over pauses the agent's next action, and the room says so. Hand back resumes it. `browser_share` posts the agent's reason as a plain message, with no card and no link. Settings, Integrations lists the browser, its tabs by agent, and a Close button that ends it. The link appears in no frame until a button is pressed.

**Goal.** The human can see any browser and take it over at any time, and can sign in for every agent at once.

**Files.** `apps/web-solid/src/chat/BrowserChip.tsx`, `app/routes/chat.tsx`, `apps/web-solid/src/settings/integrations.tsx`, `packages/protocol/src/user.ts`, `room.ts`, `schema.ts`, `apps/server/src/user/user-do.ts`, `room/room-do.ts`, `apps/cli/src/verify/suites/browser-takeover.ts`.

**Build.**

- `browserState` on the user socket: tabs by agent and the takeover flag. The chip renders from it.
- `browserLink { mode }` returns the live view URL once, and the client opens it at once. `takeover` and `handBack` set and clear the flag, optimistically.
- `browser_share` posts the reason as a plain agent message. The owner wants no card UI, so the browser bar above the composer carries the buttons.
- Strings are sentence case: "Watch", "Take over", "Hand back", "Browser", "Close".
