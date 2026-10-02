# Phase 6. Agent teams

This phase turns a one-agent room into a team. At the end, a human tags agents by name, a lead splits a goal into tasks, agents message each other through the room, a finished task wakes the agents it blocked, and the limits in architecture section 7.7 stop loops.

Every backend task here is verified with fake agents first. A fake agent is a scripted `AgentDO` test double that returns canned tool calls, so loop and ordering tests are deterministic and cost no tokens. One suite per task also runs with the test model.

## Tasks

### P6-01 Build members, recipients, and the workspace brief

`deps: P1-12` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify team-routing` passes with fake agents: an untagged message reaches only the lead, `@ada` reaches only ada, `@all` reaches everyone, and ada's next delivery carries the messages she missed.

**Goal.** Make a room hold several agents and decide who receives each human message.

**Read first.** Architecture sections 7.1, 7.2, and 7.4.

**Files.** Create `apps/server/src/room/members.ts`, `room/recipients.ts`, `room/brief.ts`, and `apps/server/test/fake-agent.ts`. Edit `room/deliver.ts`.

**Build.**

- A `members(slug, role, model, lead, status, current_task, last_delivered_seq)` table. A room has exactly one lead.
- `resolveRecipients(message, members)` as a pure function over the table in section 7.2, with tests.
- `buildBrief(member)` returns the goal, the member list with status, the member's tasks, and room messages and reactions since `last_delivered_seq`, capped at 30.
- Add `addMember`, `removeMember`, and `renameMember` to the room socket, with the member limit of 8.
- Agents report status changes to the room. The room stores the latest status only.

**Done when.** An agent that was not addressed runs no model call.

### P6-02 Build the workspace tables and tools

`deps: P6-01` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify workspace` passes with fake agents: task B depends on task A, B's owner is not woken while A is open, and marking A `done` delivers exactly one `task_unblocked` envelope to B's owner.

**Goal.** Give a team a task board, an activity log, and shared notes.

**Read first.** Architecture sections 4.3, 7.5, and 7.6.

**Files.** Create `apps/server/src/room/workspace.ts` and `apps/server/src/agent/extensions/workspace.ts`. Edit `room/schema.ts`.

**Build.**

- Tables `ws_tasks`, `ws_task_deps`, `ws_activity`, and `ws_notes`. Put them behind a `Workspace` interface.
- Tools `claim_task`, `update_task`, `post_update`, `write_note`, and for the lead `create_task`.
- Enforce the status set and reject a dependency cycle.
- On `done`, find tasks whose dependencies are all done and deliver `task_unblocked` with the id `unblocked:<taskId>`.
- Emit a room event for every board change, so the client stays live.

**Done when.** `claim_task` on a task another agent owns fails with a message that names the owner.

### P6-03 Build the messaging tools and loop protection

`deps: P6-01` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify team-loops` passes with fake agents that always reply to each other: the exchange stops at hop 8 with a system event, and a root message can cause at most 40 agent deliveries.

**Goal.** Let agents talk to each other through the room without the ability to loop forever.

**Read first.** Architecture sections 7.5 and 7.7.

**Files.** Create `apps/server/src/room/limits.ts` and `apps/server/src/agent/extensions/messaging.ts`. Edit `room/deliver.ts`.

**Build.**

- Tools `send_message(to, text)`, `broadcast(text)`, and `check_agent(slug)`. `check_agent` reads the room's member row and calls no agent.
- Store an agent message in the log with its addressee, then deliver it with `hop + 1` and the run's `rootId`.
- Enforce the hop limit, the deliveries-per-root limit, and the autonomous-runs-per-day limit in `limits.ts` as pure functions over counters in the room.
- Return a tool error that tells the agent to summarize for the human when a limit trips, and post one system event.
- A plain reply bubble wakes nobody.

**Done when.** The limits are constants in one file and each has a test at its boundary.

### P6-04 Add spawn_agent for the lead

`deps: P6-02, P6-03` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify spawn-agent` passes with the test model: asked to "get a researcher to list three sources", the lead adds a member, the member posts a result, and the task ends `done`.

**Goal.** Let the lead grow the team.

**Read first.** Architecture section 7.5.

**Files.** Edit `apps/server/src/agent/extensions/messaging.ts` and `apps/server/src/agent/factory.ts`.

**Build.**

- `spawn_agent(slug, role, task)` adds a member, creates its first task, and delivers the task as an agent message.
- Only the lead's agent selects this tool. The factory decides that from the member row.
- A spawned agent starts with the lead's model unless the lead names another connected one.
- Fail with a clear error at the member limit or on a duplicate slug.

**Done when.** A non-lead agent has no `spawn_agent` in its tool list.

### P6-05 Add the subagent tool

`deps: P1-12` `difficulty: 2` `area: backend`

**Verify.** `bun kiko verify subagent` passes with the test model: the agent delegates a task, the answer returns as a tool result, and restarting the server mid-child yields one child conversation, not two.

**Goal.** Let any agent delegate a bounded task to a private child conversation.

**Read first.** Architecture section 8. `refs/pi/packages/durable/README.md`, "Abort and Subagents", and `test/examples/22-subagent-foreground.ts`.

**Files.** Create `apps/server/src/agent/extensions/subagent.ts`.

**Build.**

- Write `spawn_subagent(task)` from the README pattern, with `replay: "safe"` and `requestId: "subagent:<taskId>"`.
- Remove the `Subagent` and messaging extensions from the child, so depth is 1.
- Publish the child conversation id with `api.details`, so P3-15 can show it as activity.

**Done when.** The extension file is under 60 lines.

### P6-06 Enforce human priority and stop across a team

`deps: P6-03` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify team-priority` passes with fake agents: a human message sent while two agents exchange messages is handled before the next agent message, and `stop` ends every run and clears waiting agent messages for that root.

**Goal.** Make the human outrank every agent.

**Read first.** Architecture sections 6.2 and 7.8.

**Files.** Edit `apps/server/src/agent/inbox.ts`, `agent/mid-run.ts`, and `room/socket.ts`.

**Build.**

- Sort the inbox by priority, then by arrival.
- Apply the mid-run table to a run that an agent message started.
- On `stop`, call `abort` on every member and delete inbox rows for the stopped `rootId`.
- Release held autonomous runs when a human message arrives.

**Done when.** No agent message is placed while a human burst is waiting in the same inbox.

### P6-07 Finish agent reactions

`deps: P1-12` `difficulty: 2` `area: backend`

**Verify.** `bun kiko verify reactions` passes: a reply of `[react:👍]` produces a reaction and no bubble, a second reaction by the same agent on the same message replaces the first, a tag with an emoji outside the allowlist is dropped, and no reaction starts a run.

**Goal.** Complete the cheap reaction path from the spec.

**Read first.** Architecture section 6.5.

**Files.** Create `apps/server/src/room/reactions.ts`. Edit `agent/outbox.ts` and `agent/prompt.ts`.

**Build.**

- Route reactions from the splitter to `room.react(slug, emoji, messageId?)`. Default the target to the last human message of the burst.
- Validate against an emoji allowlist and keep one reaction per agent per message.
- Add reactions on an agent's messages to that agent's next brief. Never deliver them on their own.
- Keep the one-line tag description in the system prompt.

**Done when.** Two fake agents that react to every message produce no runs.

### P6-08 Build the team chat interface

`deps: P6-01, P2-08` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` team chat feature: type `@`, pick an agent, send, and see only that agent answer. Open the member sheet, add an agent, and see it in the mention list.

**Goal.** Make a group chat with agents feel like a Telegram group.

**Read first.** Product document, "Agent teams".

**Files.** `apps/web-solid/src/composer/` for mentions. Create `apps/web-solid/src/chat/members/` and `chat/AgentThread.tsx`.

**Build.**

- Build the mention list from room members, replacing the bot fixture list.
- Show the author name and a small avatar on the first bubble of each agent group. A one-agent room shows neither, as in kat.
- Collapse agent-to-agent messages into a muted thread with a count, expandable in place.
- A member sheet that lists agents with role, model, and status, and adds, renames, or removes one.
- Group chats in the sidebar get a stacked avatar of up to three members, and the row's first line names the group, not one agent.
- The `+` menu offers "new group": name it and pick agents. The first agent picked is the lead.
- The top bar shows the group's avatar and name, and the composer placeholder reads `message <group name>`.
- An `@mention` inside an agent's text renders as a chip with the agent's small avatar in its color, as in the owner's reference screenshot.

**Done when.** A room with one agent looks exactly as it did before this task.

### P6-09 Build the board screen

`deps: P6-02, P2-08` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` board feature: open `/board/:chatId`, see tasks grouped by status with owner and dependencies, change a status by hand, and see the activity log update live when an agent posts.

**Goal.** Show a team's work in one place.

**Read first.** Product document, "What replaces kat's terminal and browser panels".

**Files.** Create `apps/web-solid/src/board/` (`board.tsx`, `tasks.tsx`, `activity.tsx`, `notes.tsx`).

**Build.**

- Tabs for tasks, activity, notes, and schedule, switched with no animation.
- Task columns by status with owner avatar and a blocked marker. Render columns with `content-visibility: auto`.
- An activity list on `virtua/solid`.
- Notes rendered with the rich text renderer.
- Human edits to tasks go through the room socket and apply optimistically.

**Done when.** The route is a tier 4 chunk and updates from room events with no polling.
