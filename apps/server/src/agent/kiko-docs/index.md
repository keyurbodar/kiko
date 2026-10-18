# Kiko

Kiko is a chat app. One human texts you, and sometimes other agents, in a chat. You are one agent in it. Your soul says who you are; this folder says how the app works.

Read this page first. The other pages go deeper:

- /kiko/workers-and-teams.md: chats, groups, agents, and background workers
- /kiko/tasks-routines-reminders.md: tasks and the tray, routines, reminders
- /kiko/memory.md: what you remember and how to look it up
- /kiko/recipes.md: the human's recipes and your skills
- /kiko/integrations.md: connected apps through Composio
- /kiko/browser.md: the shared browser

## The file space

| Path | What it is | Who can write |
| --- | --- | --- |
| / | This chat's files, shared with everyone in the chat | you and the human |
| /attachments/ | What the human attached to a message | nothing |
| /home/ | The human's drive, the same in every chat | you (they see a line in the chat) |
| /home/recipes/ | The human's recipes, one folder each | you |
| /me/soul.md | You, in every chat | you |
| /chat.md | This chat's goal, decisions, and who does what | you |
| /kiko/ | This folder: how Kiko works | nobody, it is read-only |

The tools `read`, `write`, `edit`, `ls`, `rm`, `mv`, `cp`, `mkdir`, and `bash` all work over these paths. `bash` sees /tmp as scratch that is not saved. Prefer `edit` to `write`: it changes one part of a file without loading the whole thing.

To make a path clickable in a reply, write a markdown link to it: `[app.ts](/src/app.ts)`, or `[src](/src/)` with a trailing slash for a folder. A bare path in backticks also links a file.

## What a turn is

A turn starts when something arrives: a human message, a teammate's message, a worker's report, a routine firing, or a task wake. Everything that arrived since your last turn comes together, in one `<context>` block plus the messages. Answer it once.

The `<context>` block holds the time and timezone, the chat's goal, the members and what each is doing, the task board, and what the human has connected. It is current; what you remember may not be. Read it before you act.

A `<system-event>` means no human asked for anything. Do what it says, then stop. When it needs no reply, answer `[skip]`.

## What you can see

- The messages in this chat, until the conversation gets long. Then Kiko compacts them and the `<memory>` block carries the history.
- Your life lines in `<memory>`: lasting facts about the human, from every chat.
- The files above.
- What your tools return.

You do not see another agent's reasoning, another chat's messages, or the human's settings. `recall` searches this chat and your life lines. `zoom` opens one line of `<memory>` in full.
