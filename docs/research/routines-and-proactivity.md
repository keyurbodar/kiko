# Routines and proactivity in Grok Bot and OpenAI dots

Read on 2026-10-05 from the vendors' own pages, in a browser. Quotes are short and exact. A claim with no quote is a summary of the page cited next to it. Architecture section 25 is what yuki builds from this.

## 1. Grok Bot (SpaceXAI)

Sources: [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot) (2026-08-11), [Designing Grok Bot](https://x.ai/news/designing-grok-bot) (2026-09-03), [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) (updated 2026-09-14), [Create and manage Bots](https://docs.x.ai/grok-bot/bots), [FAQ](https://docs.x.ai/grok-bot/faq), [Approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy), [Settings and notifications](https://docs.x.ai/grok-bot/settings-and-notifications), [changelog](https://x.ai/changelog/bot) v0.54.0 to v0.66.0, [Grok Bot 101](https://x.ai/bot/guides/grok-bot-101).

### 1.1 Routines

- A Bot is "a persistent agent with its own identity, memory, runtime, and tools". "Memory and Routines belong to the Bot", while tools and skills belong to the account (design post).
- A routine "tells one Bot when to run a workflow, on a schedule or, where supported, after an event" (docs).
- Schedules shown in the design post: every day at a time, weekdays, a weekday each week, monthly on the 1st, every 30 minutes. One-time reminders show "Once" with a date and time (v0.56.0). The schedule uses the Bot's timezone setting.
- Events shown in the design post: GitHub (issue created, PR opened, merged, closed, push to main, checks fail, label added, comment containing `/fix`, review approved, thread resolved, workflow fails), Slack (new messages in a channel, reaction added, channel created), Linear (issue created, status change, end of cycle), PagerDuty incidents, and "When webhook receives a POST". A routine that watches one pull request runs only for that pull request (v0.56.0).
- Creation is by asking the owning Bot. The docs list what to confirm: the owning Bot, the schedule and time zone, the input source, the expected result, the approval boundary, and what happens when a source is missing. "The Bot creates the routine and shows its next run." The transcript shows a "Created Routine" card (design post). A Bot "can set its own schedule or listen for events" (Grok Bot 101).
- The docs warn: "Avoid broad listeners such as 'every new message.' They create noise, consume usage, and increase the chance of acting on irrelevant input."
- "A test run performs real work."
- A Bot owns at most 50 routines. The app keeps the 20 most recent runs per routine. Deleting a routine is immediate. Deleting a Bot deletes its routines. Duplicating a Bot copies its routines.
- "Grok Bot may ask whether to keep routines running after a long period away and pause them if there is no response."
- Results land in the Bot's conversation. "The transcript shows what ran and gives the user a place to review the result or handle an exception."
- Design advice in the docs: prepare before executing, draft first, require approval for sending, purchasing, deleting, publishing, or changing production, include a no-data and stale-data policy, make retries idempotent, and say where partial completion goes.
- NOT FOUND: whether a routine run starts from a fresh context. The docs say memory belongs to the Bot and results post into its conversation.

### 1.2 Proactivity

- Launch post: Bots "can follow up on threads you dropped, nudge a stalled handoff, and pick work back up from previous conversations. Over time they become more proactive". They learn "when to ping versus keep going".
- v0.66.0 (2026-10-02): "Choose a primary Bot, marked Main Bot with a star, that checks in proactively and coordinates work with your other Bots".
- Proactive suggestions rolled out on 2026-10-01: the primary Bot offers to take work off the user's plate. The vendor said suggestions do not count against usage ([secondary report](https://www.progressiverobot.com/2026/10/02/primary-bot-grok-4-7-base-model-proactive-grok-bot/)). How often it checks and what it reads are not published.
- Coordination: users made a Chief of Staff Bot. "Coordinating Bots handle routine routing and bring the user in when a decision requires judgment." Group chats hold at most six Bots.
- Presence: the avatar shows idle, thinking, working, waiting, blocked, done. The sidebar separates "Needs attention" from "Unread activity" (settings page).
- v0.59.0: "When you message a busy Bot, it answers you before working through queued updates from other Bots, Cloud Agents, and background tasks."
- v0.56.0: stopping a Bot also stops the Bots it handed work to. v0.66.0: a hung Bot "stops itself with a note".

### 1.3 Safety

- Auto Review checks tool calls and computer actions before they run. "Ask first" rules always stop. "Allow automatically" rules proceed only when the review finds no other reason to stop. "If both kinds of rule match, Ask first wins." Cards offer Allow once, Always allow, Deny.
- All of a user's Bots share one cloud computer: "Do not use separate Bots as a security boundary."

## 2. OpenAI dots

Sources: [Introducing dots](https://openai.com/index/introducing-dots/) (2026-09-29), [How we build safety, security, and privacy into dots](https://openai.com/index/how-we-build-safety-security-and-privacy-into-dots/), [Getting started with your dot](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot), [Dots privacy, security, and safety FAQs](https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs), [GPT-6 Astra system card](https://deploymentsafety.openai.com/gpt-6-astra/change-log) appendix 12, [Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review).

### 2.1 What starts work

- The help center lists every way a dot starts without a new message: it "can research in the background and suggest ways to help. It can also review connected information proactively and form memories from it... It can run reminders or recurring tasks you've scheduled."
- Scheduled tasks are made by asking ("set a reminder or run a recurring check"). "Scheduled runs and proactive updates appear in the conversation." A Scheduled list shows active, paused, and completed tasks, each with its repeat schedule, time, and completion notifications.
- The profile groups work as In progress, Scheduled, Completed. Activity View shows ongoing and delegated tasks; the user can add context, redirect, or stop.

### 2.2 Proactive research

- "Alongside the work you ask them to do, dots can start background research tasks to look for other ways to help."
- "They use read-only tools to gather information from permitted connected sources, then save private notes for that dot. We enforce these limits in code: the research tasks cannot directly send messages to other people, change content in connected apps, or control a browser or desktop."
- "Dots can use the findings to decide how to help, but any follow-up action must follow the usual rules and checks." Custom Rules cannot change the research restrictions.
- A note reaches a conversation only when it is relevant (the Lisbon example on the safety page).

### 2.3 Boundaries

- Custom Rules choose one of four behaviors for an action: take action without asking, take action if pre-approved, ask before taking action, hand off to you. "Pre-approved means you explicitly requested the action in your prompt." A dot may draft a rule and needs approval to change one.
- "Approving one message does not give your dot ongoing permission to contact people on your behalf." Authorization "stays tied to your instructions for the task; continuing later or delegating work does not expand it."
- Auto-review is a separate model that checks consequential actions. On a denial the dot may ask, try a permitted alternative, hand off, or stop. In Codex the reviewer interrupts a turn after 3 denials in a row or 10 in the last 50 reviews.
- The system card: "dots use a new time-budget setting that guides how long they work". Evaluations gave the model "a clock tool with wait functionality".
- Measured in the system card: across chained tasks, moderate scope violations went from 8.6% to 19.7% when intervening tasks doubled from five to ten. Revoked permissions were handled in all 17 explicit cases. Misleading proactivity inputs caused 0 misaligned actions in 151 tasks.
- Pause stops a dot. Reset deletes its conversations, memories, and scheduled tasks. Individual memories cannot be viewed or edited.

## 3. What yuki takes

| Idea | From | Yuki section |
| --- | --- | --- |
| a routine is a standing job owned by one agent, made from chat, confirmed with a card | Grok | 25.2 |
| schedule, event, and webhook triggers, with narrow filters | Grok | 25.4 |
| 50 routines per agent, 20 runs kept, test run, pause | Grok | 25.2 |
| pause routines after a long absence | Grok | 25.5 |
| a coordinator that checks in | Grok Main Bot | 25.7 |
| background research with read-only tools enforced in code, private notes | dots | 25.7 |
| authorization never widens when work continues or is delegated | dots | 25.3 |
| a time budget per run, and a breaker after repeated failures | dots, Codex | 25.2 |
| nudge stalled handoffs | Grok | 25.6 |

Not taken, by the owner's decision on 2026-10-05: push notifications, voice, Slack and Teams, a computer and browser per agent, and a reviewer model.
