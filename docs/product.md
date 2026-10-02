# Kiko product

Kiko is a general-purpose AI chat web app that feels like texting on Telegram. You talk to one assistant or to a team of agents in a group chat. The agents remember you, set reminders, use your connected apps, and keep working after you close the tab.

This document says what kiko is, who uses it, what it does, and what it does not do. [architecture.md](architecture.md) explains how it is built and why.

Three labels appear in both documents.

- **ASSUMPTION** marks a choice made where the spec was silent or ambiguous. The simplest option was taken.
- **UNVERIFIED** marks a fact that could not be confirmed from `refs/` or official docs.
- **DEVIATION** marks a place where the plan departs from the spec on purpose, with the reason.

## Who uses kiko

Kiko is for people who want one assistant for daily life and work, not for programmers who want a coding agent.

- **The daily user.** Asks questions, plans a trip, drafts an email, sets a reminder, sends a photo and asks what it is. Types the way people text, in short bursts.
- **The delegator.** Hands a goal to a team of agents ("plan the launch"), tags agents by name, checks the group's tasks, and interrupts when something goes the wrong way.
- **The connector.** Links a personal Executor Cloud account so agents can act in calendars, mail, issue trackers, and other APIs under policies the user controls.

Every user brings their own model access. Kiko does not sell, pay for, or choose models.

## Product principles

1. **Chat first.** Every feature is reachable from a conversation. The files and memory views and a group's task sheet show state that the chat already created.
2. **Instant.** Navigation, buttons, menus, tabs, and the composer respond in the same frame. The app paints from local data before the network answers.
3. **Human pacing.** An agent reads a burst of messages together and answers once, in short bubbles. It can react with an emoji and say nothing.
4. **The human outranks every agent.** A human message is handled before agent messages and can interrupt work in progress.
5. **Your keys, your data.** Credentials are encrypted per user and never return to the browser. Agents of one user cannot reach another user.
6. **Lowercase voice.** Every interface string is lowercase, as in kat. Docs and code are not.

## Features

### Chats

A chat is a room with you and one or more agents. A chat with a single agent and a chat with a team are the same thing with a different member count.

- Send text, files, images, and replies. Messages appear at once and reconcile with the server later.
- The agent waits for a pause in your typing, reads the whole burst, and answers once.
- Replies arrive as separate bubbles, one per paragraph, with a typing indicator between them.
- Agents react to a message with an emoji. A reaction can be the whole answer.
- Send a message while the agent works. Kiko restarts, steers, or queues the work by fixed rules (see architecture section 6).
- Stop a run with the stop button.
- Open chats sit in a horizontal tab strip, as in kat.

### Agent teams

- Add agents to a chat by name and role, or let the lead agent add them.
- Tag an agent with `@name`. An untagged message goes to the lead.
- The lead agent splits a goal into tasks, assigns them, and reviews results.
- Any agent can spawn private subagents to finish a task.
- Agents message each other in the room, where you can read it. Agent-to-agent threads are collapsed by default.
- A group chat's info sheet shows tasks with owner, status, and dependencies, and shared notes. Task changes also appear as muted lines in the transcript.
- When a task finishes, agents blocked on it wake up.
- Hop limits and a daily autonomous-run budget stop agents from messaging each other forever.

### Memory

- Kiko keeps a profile of you, a short "what's going on" page, and notes about people, organizations, preferences, procedures, and past conversations.
- Agents read the profile on every turn and search the rest when needed.
- A background job tidies memory once a day. It merges duplicates, shortens notes, records corrections with dates, and archives notes nobody has used.
- You can read, edit, pin, and delete every note. Each note keeps its version history.

### Reminders and scheduling

- Ask in chat ("remind me every monday at 9"). The agent creates the reminder in your timezone.
- A due reminder arrives as a message in the chat it was created in.
- Recurring reminders follow RRULE.
- Agents schedule their own follow-up work and wake other agents the same way.

### Integrations

- Connect your Executor Cloud account in settings. Kiko offers every tool Executor exposes, with nothing hardcoded.
- Executor policies decide whether a tool runs, needs approval, or is blocked. An approval request appears as a card in the chat. Only you can approve it.
- Disconnect at any time. Kiko deletes the tokens at once.

### Models and providers

- Settings lists the providers and models from the pi-ai catalog.
- Connect a provider with an API key or with the sign-in flow that pi-ai offers for it.
- Kiko shows the last four characters of a saved key and nothing else.
- Pick a model per chat and per agent.
- A chat with no connected provider shows a prompt to connect one.

### Files

- Each chat has a file space. Attachments and files that agents write land there.
- The files route shows a file tree that looks and behaves like kat's tree, and a viewer and editor for text files.
- Images, video, and audio open in a Telegram-style viewer with zoom, swipe, and albums.

### Skills

- A skill is a `SKILL.md` file with a name and a description. Agents see the list and load a skill body only when a task needs it.
- Kiko ships built-in skills. You can add your own per account or per chat.
- Type `/skill:name` to apply a skill by hand.

### Chat interface details

Kiko keeps what already works in `apps/web-solid` and adds or fixes the following.

| Feature | State today | Plan |
| --- | --- | --- |
| Reply and quote previews | present | keep, wire to real data |
| Swipe to reply | icon on the right, drag left | reply icon enters from the left, drag right |
| Collapsed long messages ("read more") | missing | build, with fade and chevron as in kat |
| Markdown and code blocks | missing | build, code via sugar-high |
| Link previews | dev-only proxy in `vite.config.ts` | server-side fetch, tweb-style card |
| Lightbox, albums, multi-file attachments | present, not Telegram-exact | fix to match tweb behavior |
| Audio and video player | native controls only | build |
| Date divider, unread divider, system events | divider and unread rule present, system events missing | port the astryx `ChatSystemMessage` pattern |
| Typing indicator | basic row | port the reference component (see the note below) |
| Toasts | never render | mount the toast region |
| Virtual lists | chat feed only | chat feed, sidebar chat list, search results, all on `virtua/solid` |

**Note on the typing indicator.** The React reference from spec section 6.6 is saved unchanged at [reference/typing-indicator.react.tsx](reference/typing-indicator.react.tsx). The Solid port keeps its timings, its label rules, and its geometry (a 68 by 34 px bubble at the default size, 8 px dots, a 5 px gap). The rapid-fire example that spec section 4.5 calls "img #1" is `~/kat-images/screenshot 8.png`.

### Suggested additions

The spec asks for other interface features worth having. These are in the plan.

- Stop button and "regenerate" on the last agent answer.
- Edit your last message, which reruns the answer.
- Approval cards for integration actions.
- A disclosure on agent bubbles that shows the tools the agent used. Kat shows the same chevron.
- Message search per chat and across chats.
- Command palette with `noun: verb` entries, as in kat.
- Slash commands in the composer (`/skill:`, `/remind`, `/new`).
- Per-chat drafts and scroll position that survive reloads.
- Pinned messages and jump to first unread.
- Copy button on code blocks.
- Per-chat usage meter (tokens and cost from pi-ai pricing data).
- Paste and drag-and-drop upload.
- Export a chat as a markdown file.

Later, not in the first plan: voice input, vector search for memory, a light theme.

## Screens and routes

The layout follows the kat screenshots in `~/kat-images`. A 60 px icon rail, a 280 px sidebar, and the main panel with a 50 px top bar.

| Route | Rail icon | Sidebar | Main panel |
| --- | --- | --- | --- |
| `/chat`, `/chat/new`, `/chat/:id` | chat | pinned tiles and chat list | tab strip, transcript, composer |
| `/files`, `/files/:chatId/*path` | files | file tree | viewer and editor |
| `/memory`, `/memory/:id` | none | none | redirects to the active chat with the info panel open on memory (P2-19) |
| `/settings/*` | settings (bottom) | sections | providers, models, integrations, skills, account |

Overlays: command palette, calendar jump, context menus, media viewer, approval card, onboarding.

### What replaces kat's terminal and browser panels

Kat has four rail items: chat, terminal, code, browser. Kiko has no terminal and no browser. Three options were weighed for the two free slots.

| Option | Slot 1 | Slot 2 | Verdict |
| --- | --- | --- | --- |
| A | board (tasks, activity, notes, schedule) | memory (notes, profile, history) | **chosen** |
| B | activity (live agent log) | integrations | rejected. Activity alone is thin, and integrations are visited once |
| C | schedule (calendar of reminders) | memory | rejected. A schedule tab inside the board covers it |

Option A was chosen at first. On 2026-10-02 the owner made group chats of agents, laid out like Telegram groups, the center of team work. A separate board then duplicates the chat, so it was dropped. The same day the owner asked to fold memory into a per-chat info panel opened from the chat's name, as Telegram and kat do (P2-19). DEVIATION from option A: the rail has chat, files, and settings. A group's tasks and notes live in the group's info sheet (P6-09), and reminders live in every chat's info sheet (P5-07). Kat's code slot becomes files.

## Non-goals

- No coding or app-building agent. No containers, no shell, no terminal, no in-app browser.
- No model hosting, no kiko-paid model access, no curated model list.
- No self-hosted integration layer and no kiko-built MCP connectors. Executor Cloud only.
- No notifications of any kind, including push.
- No share URLs and no public links.
- No chats between two human users. A chat has one human.
- No native mobile apps. The web app must work well on phones.
- No Convex and no Confect.
- No rebuild of what pi already does for model access. The provider catalog, provider sign-in flows, and the agent loop come from pi.

## Plans and limits

Kiko runs on the Cloudflare Workers Free plan now. The design keeps a clean path to Workers Paid and to kiko subscriptions.

- Per-user limits (turns per day, autonomous runs per day, storage) live in one `limits` record in the user's Durable Object. A plan is a named set of those numbers.
- No billing code ships in the first plan.
- The free-tier ceiling is small. Section 17 of the architecture document shows the math.
