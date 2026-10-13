# Kiko product

Kiko is a general-purpose AI chat web app that feels like texting on Telegram. You talk to one assistant or to a team of agents in a group chat. The agents remember you, set reminders, use your connected apps, and keep working after you close the tab.

This document says what kiko is, who uses it, what it does, and what it does not do. [architecture.md](architecture.md) explains how it is built and why.

Three labels appear in both documents.

- **ASSUMPTION** marks a choice made where the spec was silent or ambiguous. The simplest option was taken.
- **UNVERIFIED** marks a fact that could not be confirmed from the official docs.
- **DEVIATION** marks a place where kiko departs from the spec on purpose, with the reason.

## Who uses kiko

Kiko is for people who want one assistant for daily life and work, not for programmers who want a coding agent.

Kiko is self-deployed. One person deploys it to their own Cloudflare account and is its only user. Other people do not sign in, and there is no sign-up. [self-deploy.md](self-deploy.md) shows how to set it up.

- **The owner.** Deploys kiko, sets the access code, and connects the model keys and Composio key. Owns every chat, memory line, and routine.
- **The daily user.** Asks questions, plans a trip, drafts an email, sets a reminder, sends a photo and asks what it is. Types the way people text, in short bursts.
- **The delegator.** Hands a goal to a team of agents ("plan the launch"), tags agents by name, checks the group's tasks, and interrupts when something goes the wrong way.
- **The connector.** Links a personal Composio account so agents can act in calendars, mail, issue trackers, and other apps the user connects there.

The owner brings their own model access. Kiko does not sell, pay for, or choose models.

## Product principles

1. **Chat first.** Every feature is reachable from a conversation. The files and memory views and a group's task sheet show state that the chat already created.
2. **Instant.** Navigation, buttons, menus, tabs, and the composer respond in the same frame. The app paints from local data before the network answers.
3. **Human pacing.** An agent reads a burst of messages together and answers once, in short bubbles. It can react with an emoji and say nothing.
4. **The human outranks every agent.** A human message is handled before agent messages and can interrupt work in progress.
5. **Your keys, your data.** Credentials are encrypted in your own Worker and never return to the browser. Your data stays in your Cloudflare account.
6. **Sentence case.** Interface strings are sentence case, as in monocode and t3code, and names keep their own casing. DEVIATION: kat uses all lowercase. Kiko uses sentence case so the app reads like the tools it sits beside.

## Features

### Chats

A chat is a room with you and one or more agents. A chat with a single agent and a chat with a team are the same thing with a different member count.

- Send text, files, images, and replies. Messages appear at once and reconcile with the server later.
- A long message goes in one send. Text past 16,000 characters is stored whole as a file named `message.txt`, and the bubble shows its first part. An edit is limited to 16,000 characters, because an edit cannot carry a file.
- The agent waits for a pause in your typing, reads the whole burst, and answers once.
- Replies arrive as separate bubbles, one per paragraph, with a typing indicator between them.
- Agents react to a message with an emoji. A reaction can be the whole answer.
- Send a message while the agent works. It never waits for the run to end. If a tool is running, kiko stops that tool and passes your message in. If the agent has posted nothing yet, the run restarts with your message. Otherwise your message steers the run (architecture section 6.2).
- Stop a run with the stop button. Messages still waiting in the burst go out after the stop, as sent.
- Open chats sit in a horizontal tab strip, as in kat.

### Agent teams

- Add agents to a chat by name and role, or let the lead agent add them.
- Tag an agent with `@name`. An untagged message goes to the lead.
- The lead agent splits a goal into tasks, assigns them, and reviews results.
- Any agent can hand slow work to its own background workers and keep talking while they run. An agent runs up to three at once. One worker takes a whole job and runs its parts together.
- Ask for status while work runs. The lead reports each running worker and its step. A status question does not stop or redirect a worker.
- Agents message each other in the room, where you can read it. Agent-to-agent threads are collapsed by default.
- The Tasks tab in a group's sidecar lists tasks by status, with each owner and what the task waits on.
- When a task finishes, agents blocked on it wake up.
- Hop and root limits stop agents from messaging each other forever.

### Memory

- Kiko keeps one log of what you say and what each chat does. Short summaries of the log are what an agent reads when a run starts.
- When a judge model is connected, facts come from what you say. A correction replaces the fact it corrects, and the old line is marked Replaced. Without a judge, lines come from your own additions and from agents' notes.
- Agents can recall, zoom into, and note memory.
- The memory screen lists every line, newest first, with search and a box to add a line. Pin up to 10 lines to head what agents read. Redact a line to remove its text for good. Agents cannot pin or redact.

### Reminders and scheduling

- Ask in chat ("remind me every monday at 9"). The agent creates the reminder in your timezone.
- A reminder can be at most a year away. A chat holds 100 open reminders.
- A due reminder arrives as a message in the chat it was created in.
- Recurring reminders follow RRULE, and repeat no faster than every 30 minutes.
- Agents schedule their own follow-up work and wake other agents the same way.
- Ask an agent to do something on a schedule or when something happens ("every weekday at 8, tell me what needs me today"). It sets up a routine at once. An agent may also make one on its own. Each run answers in the chat, or stays quiet when nothing needs you.
- About once a day, kiko reads what is open across your chats, at a time that fits when you usually read. It then stays quiet or offers up to three things it could take off your plate.
- Agents follow up on things you or an agent said they would do. An ignored nudge makes kiko wait longer before the next one.

### Integrations

- Paste your Composio project API key (`ak_...`) in settings. It is the one key kiko needs. Kiko offers every tool Composio lists, with nothing hardcoded. Apps are connected in your Composio account.
- Agents use these tools without asking first.
- Disconnect at any time. Kiko deletes the key at once.

### Models and providers

- Settings lists the providers and models from the pi-ai catalog.
- Connect a provider with an API key or with the sign-in flow that pi-ai offers for it.
- Kiko shows the last four characters of a saved key and nothing else.
- Pick a model per chat and per agent.
- A chat with no connected provider shows a prompt to connect one.

### Files

- Each chat has one file space, rooted at `/`. What you attach lands under `attachments/`. Agents write their files anywhere in the space.
- A message keeps the files the human attached, and agents read them. Agents attach nothing: they name a path in their text, as t3code's assistant does.
- The Files tab in a chat's sidecar shows a file tree that looks and behaves like kat's tree. Open files are tabs, as in t3code's right panel, and each shows under its path and actions: rendered or source, word wrap, copy, save, the tree, and close. Text and code show their source with line numbers and stay editable; markdown, CSV and HTML can render; pictures, PDFs, video and sound show in the panel. A text file past 1 MB shows its first 1 MB, read only.
- DEVIATION (2026-10-09): there is no media viewer, album, thumbnail, or media and links catalog. The owner chose t3code's simpler attachments.
- Attaching works as in t3code. The attach button, a paste, or a drop anywhere on the chat adds files to the composer; while files are dragged over the page a dashed overlay says "Drop files to attach". Pictures (GIF, JPEG, PNG, WebP) show as 64 px thumbnails with a remove button on the corner, and a click previews one. Any other file shows as a row with its name, size, and a remove button. Up to 100 files go on one message, any other file up to 50 MB, and pictures up to 80 MB together. A picture over 10 MB is shrunk to fit, and an SVG, a HEIC, or another picture kiko cannot send is refused; a toast says why a file was left out.
- Each file starts uploading the moment it is picked, as in t3code. A thumbnail shows the percentage along its bottom edge and a file row shows it in place of the size. A failed upload shows a retry button whose tooltip says why, and it is retried when the connection comes back. Send waits, and says why, until every file is up: "Attachment still uploading", or "Retry or remove the failed attachment". Removing a file, or leaving it unsent, deletes its upload.
- A sent message shows its pictures as a small grid of 4:3 tiles above its text, and its other files as one row each, with an icon, the name, and the size. One click opens the file in the files tab when it can show it, else in a new browser tab. Download is in the file's own view. A message of only files shows only them. A message is shown at once from the local copies and switches to the stored files when the room confirms it. If the room cannot take a file (it expired, or it was removed), the message stays marked failed and a toast says why.
- A picture opens in an image dialog: the picture over a dark backdrop, its name and place (`photo.png (2/3)`) under it, arrows and the arrow keys to move, and Escape or a click outside to close. It opens with no animation. As in t3code, the wheel zooms around the pointer up to 8x, a click or Enter toggles 2x, + - and 0 zoom from the keyboard, and a zoomed picture pans by dragging or with the arrow keys.

### Skills

- A skill is a `SKILL.md` file with a name and a description. Agents see the list and load a skill body only when a task needs it.
- Kiko ships built-in skills. You cannot add your own yet.
- Type `/skill:name` to apply a skill by hand.

### Chat interface details

Kiko keeps what already works in `apps/web-solid` and adds or fixes the following.

| Feature | State today |
| --- | --- |
| Reply and quote previews | present |
| Swipe to reply | removed 2026-10-09. On a pointer device, hovering a message shows react, reply and "…" beside the bubble; touch keeps the long-press menu (DEVIATION, the owner's macOS screenshots) |
| Emoji | the platform's emoji font, kiko's own picker, and `:shortcode` completion in the composer. Twemoji was removed 2026-10-09 |
| Long messages | a body taller than 176 px is clamped with a 28 px fade and a "Show full message" text button under it. "Show less" folds it again. Both senders use it, and the reader's place on the page does not move |
| Markdown and code blocks | present, with a copy button on code |
| Links | underlined text in the bubble's colour, with the full address in the hover title. No preview card, no favicon, and no fetch. Only `https:` and `mailto:` become links. A link whose text names another host opens a warning first (DEVIATION from t3code, which shows a favicon) |
| Attachments | a picture grid, file rows, and an image dialog, as t3code shows them (DEVIATION, see Files) |
| Audio and video | native controls only |
| Date cue, unread rule, system events | one sticky date chip ("Today", "Yesterday", or a short date) shows the day while the thread scrolls. A day change or a gap over 20 minutes leaves a time-only line in the thread. The unread rule and system events are present |
| Typing indicator | present |
| Toasts | present |
| Virtual lists | the chat feed and the sidebar's chat list |

**Note on the typing indicator.** The React reference from spec section 6.6 is saved unchanged at [reference/typing-indicator.react.tsx](reference/typing-indicator.react.tsx). The Solid port keeps its label rules and its shape: a one-line agent bubble of three dots. The dots say what the agent is doing by how they move: kat's wave while it writes, a scan while it reads, a hop while it edits, an orbit while a tool runs. A slow act adds a muted caption. Each working agent gets its own bubble, and in a group each carries the agent's avatar.

### Suggested additions

The spec asks for other interface features worth having. These are listed below.

- Regenerate on the last agent answer.
- Edit your last message, which reruns the answer.
- A disclosure on agent bubbles that shows the tools the agent used. Kat shows the same chevron.
- Message search per chat and across chats.
- Per-chat drafts and scroll position that survive reloads.
- Pinned messages and jump to first unread.
- Per-chat usage meter (tokens and cost from pi-ai pricing data).
- Export a chat as a markdown file.

Later, not in the first plan: voice input, vector search for memory, a light theme.

## Screens and routes

The layout follows the kat screenshots in `docs/reference/`: an icon rail, a sidebar, and a main panel with a 50 px top bar. UNVERIFIED: the 60 px rail and 280 px sidebar widths from the kat spec. The code does not confirm them.

| Route | Rail icon | Sidebar | Main panel |
| --- | --- | --- | --- |
| `/`, `/chat`, `/chat/:id` | chat | pinned tiles and chat list | tab strip, transcript, composer. The chat card floats over the thread. The sidecar holds one tab per surface: files, memory, on your plate, routines, tasks, and agents |
| `/files`, `/files/:chatId/*path` | none | none | opens the chat with the sidecar on Files, on the file if one is named |
| `/memory`, `/memory/:id` | none | none | opens the active chat with the sidecar on Memory |
| `/settings/*` | settings (bottom) | sections | providers, models, integrations, skills, account |

Sign-in: the access code. The owner sets it as the `ACCESS_CODE` secret. The sign-in screen asks for it, and no one else can sign in.

Overlays: command palette, calendar jump, context menus, onboarding, and the image dialog, which zooms and pans as t3code's does. The media viewer is gone (DEVIATION, 2026-10-09): the files tab draws a picture inline.

### What replaces kat's terminal and browser panels

Kat has four rail items: chat, terminal, code, browser. Kiko has no terminal and no browser. Three options were weighed for the two free slots.

| Option | Slot 1 | Slot 2 | Verdict |
| --- | --- | --- | --- |
| A | board (tasks, activity, notes, schedule) | memory (notes, profile, history) | **chosen** |
| B | activity (live agent log) | integrations | rejected. Activity alone is thin, and integrations are visited once |
| C | schedule (calendar of reminders) | memory | rejected. A schedule tab inside the board covers it |

Option A was chosen at first. On 2026-10-02 the owner made group chats of agents, laid out like Telegram groups, the center of team work. A separate board then duplicates the chat, so it was dropped. The same day the owner asked to fold memory into a per-chat info panel opened from the chat's name, as Telegram and kat do. DEVIATION from option A: the rail has chat and settings only. Memory, files, tasks, and routines live in each chat's right panel. Kat's code slot became the Files tab in that panel. On 2026-10-13 that panel became a tabbed sidecar, and the chat's details moved to a card over the thread (DEVIATION, 2026-10-13).

## Non-goals

- No coding or app-building agent. No containers, no shell, no terminal, no in-app browser.
- No model hosting, no kiko-paid model access, no curated model list.
- No self-hosted integration layer and no kiko-built MCP connectors. Composio only.
- No notifications of any kind, including push.
- No share URLs and no public links.
- No chats between two human users. A chat has one human.
- No native mobile apps. The web app must work well on phones.
- No Convex and no Confect.
- No rebuild of what pi already does for model access. The provider catalog, provider sign-in flows, and the agent loop come from pi.
- No sign-up, no second user, and no billing.

## Plans and limits

Kiko runs on the Cloudflare Workers Free plan. One owner stays well inside it. Architecture section 17 has the numbers.

- A chat holds up to 100 open reminders.
- Hop and root limits cap any chain of agent messages.
