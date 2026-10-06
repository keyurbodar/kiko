# Endgame backend audit

On 2026-10-06 the owner asked for one pass that fixes everything wrong in the backend: the agent-to-agent loop, approvals, memory and recall, and wasted turns, tokens, and latency. Three read-only audits covered those areas. This page lists what they found and what kiko decided. Each row names the lane that fixes it. The status column is filled in as fixes land.

Lanes: **A** approvals and trust, **B** the agent-to-agent loop and the room, **C** memory, the prompt, and per-run cost.

## Approvals: the decision

The owner's rule: kiko asks only when it really matters. The trust gate asked far more often than that. Executor results taint a run, so the second `execute` of any task posted a card. Reading the agent's own files tainted the run. Reminders, task wakes, and extension triggers ran as `auto`, so each external call posted a card, often at 7am to a sleeping human, and the card expired after four minutes and woke the agent to say so.

The new table (`needsApproval` in `agent/extensions/trust.ts`):

| Run | external tool |
| --- | --- |
| started by the human (`human`), tainted or not | runs. Executor's own pause still stops every action an app marks for a person |
| a routine (`routine`) | granted tools run, tainted or not, when the routine was made by a clean run. Others post a card |
| nobody asked (`auto`) | a card, unless the human accepted one for this agent in the last 30 minutes |

- An accepted card is a 30-minute grant for that agent over every `external` tool. The one-shot card that matched exact arguments is deleted.
- A card that expires closes quietly. It wakes nobody.
- A reminder, a task wake, and an approval result carry the authority of the chain that made them, so work the human asked for keeps the human's authority.
- An extension's trigger runs as a routine granted that extension's own tools. The human reviewed and installed it.
- `create_routine` and `update_routine` post a card only for a run the human did not start, or a tainted run that grants tools.
- DEVIATION from section 16.3. A tainted run the human started may act outside kiko without a kiko card. The risk: an injected page could steer a send that Executor does not pause for. Taint still flags what the run stores and sends, `[outside]` still marks memory, and section 16.4 still blocks preview exfiltration.

Taint holes closed at the same time, because `auto` and `routine` runs still depend on taint:

- `spawn_subagent` returns a tainted helper's answer as tainted.
- `ask` returns a tainted teammate's answer as tainted.
- A tainted run cannot write `/me/soul.md`, `skills/`, or `extensions/`, which reach every later system prompt.
- `/api/experiments/*` named an `AgentDO` from a query parameter in production. It is development only now.

## Findings

| # | Area | Finding | Lane | Status |
| --- | --- | --- | --- | --- |
| 1 | a2a | Batches held while an agent works keep their request ids, so three teammate replies cost three runs, not one (`inbox.hold`) | B | |
| 2 | a2a | A teammate that answers an `ask` in a plain bubble never reaches the asker, which waits two minutes and then gets nothing | B | |
| 3 | a2a | Every human message cancels every busy agent's `ask` and holds its mail for 10 s, even when the message is for someone else | B | |
| 4 | a2a | A question sent with `ask` settles the recipient's own open ask as if it were the answer | B | |
| 5 | a2a | Mail held in an inbox rewrites the chain (root, hop, authority) of the run in progress | B | |
| 6 | a2a | Task wakes start a new `auto` chain, so a project the human asked for loses its authority and its loop limits | B | |
| 7 | a2a | Mail queued during a burst the room refused waits until some later event | B | |
| 8 | a2a | An approval result has no origin and does not update the chain | A | |
| 9 | a2a | A batch dropped for a missing credential leaves a teammate's ask hanging | B | |
| 10 | a2a | Helpers keep the chief, reminder, routine, and task-board tools | A | |
| 11 | cost | Each batch carries every distinct brief, and every input repeats an unchanged brief | C | fixed (lane C) |
| 12 | cost | The memory delta repeats messages that joined the last run as steers or queued inputs | C | fixed (lane C) |
| 13 | a2a | `beginRun` and its RPCs run before the hold checks, again for every held batch | B | |
| 14 | latency | Three independent RPCs in a row before the first model token (`extensionsFor`, `turnContext`, `memorySince`) | C | fixed (lane C) |
| 15 | latency | The burst flush calls UserDO twice in a row | B | |
| 16 | latency | Every agent message reads the chat row again, and broadcasts deliver one recipient at a time | B | |
| 17 | latency | Short replies ("yes", "do it") wait 2.5 s as fragments | B | |
| 18 | latency | Mail between two agents waits for a human burst addressed to a third | B | |
| 19 | cost | Every tool start and end flips working and typing: two RPCs each | B | |
| 20 | cost | `touchChat` runs twice per run | B | |
| 21 | cleanup | `members.last_delivered_seq` and `current_task` are dead. The inbox, `agent_sends`, `root_counts`, and `stopped_roots` only grow, and `max(arrival)` scans the inbox | B | |
| 22 | memory | The prompt tells agents to recall before they look at the conversation they already have | C | fixed (lane C) |
| 23 | memory | The prompt says tool output is gone once a task pauses. It stays until the transcript is full, so agents fetch it again | C | fixed (lane C) |
| 24 | memory | The zoom id the block suggests (`zoom 12`) is one the tool rejects | C | fixed (lane C) |
| 25 | memory | `recall` returns 16-token snippets, so it is usually followed by a zoom. Its description promises other chats and newest first, and gives neither | C | fixed (lane C) |
| 26 | cost | `note`, the soul, and `/chat.md` overlap, so one fact can cost three writes. Notes dedupe only exact text | C | fixed (lane C) |
| 27 | memory | The restart budget counts the opening memory block, so a long chat restarts mid-task | C | fixed (lane C) |
| 28 | latency | The soul, `/chat.md` (from R2), and the skills list are read before every model request | C | fixed (lane C) |
| 29 | cost | `turnContext` builds the life view on every run, though only a fresh start uses it. Extensions sync on every run | C | fixed (lane C) |
| 30 | memory | Storage compaction counts every run, not fresh starts, so short chats restart cold every 50 runs | C | fixed (lane C) |
| 31 | memory | Message ids for `[react:...]` appear only when a batch has two human messages | C | fixed (lane C) |
| 32 | a2a | Nothing tells agents not to acknowledge each other or to retell what a teammate already posted | C | fixed (lane C) |

## Kept on purpose

- Executor's own pause card. It is the app saying a person must approve.
- Extension install and update. Only the human installs (invariant).
- kiko's proposal before it makes an agent or a group. It is a chat line, not a card.
- `to: all` wakes every other agent. The prompt discourages it for anything that needs no answer.
- Memory and summaries do not taint a run (section 13.4, measured).
- Reading a chat file still taints the run. After the new table, taint no longer decides any card in a human or granted routine run, so a per-file taint bit would add code and remove no card.
