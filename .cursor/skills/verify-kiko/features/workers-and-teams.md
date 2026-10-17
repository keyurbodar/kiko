# Workers and teams

A room can hold one human and several agents. The lead gets untagged messages and may add agents. A worker is a background child conversation inside an agent that runs slow work while the agent keeps talking.

Target behavior lands in the rework; today's behavior differs.

## Sub-features

- Add an agent to a room with "Mention an agent" or the room's member list.
- Tag an agent in a message. Only the tagged agent answers.
- Untagged messages go to the lead.
- A worker runs a slow task and reports back in the same chat.
- A team answers in a fixed order when several agents are tagged.

## How to get to it (user POV)

1. Create a new chat from "New chat" in the sidebar.
2. Click "Mention an agent" in the composer to pick an agent.
3. Send a message that tags the agent. Wait for its reply.
4. For a worker, ask for a slow job ("research X and report back"). The chat should show the job running, then the result.

## Driving it with agent-browser

```bash
S=kiko-<run-id>
agent-browser --session $S snapshot -i                                  # find "New chat" and "Mention an agent"
agent-browser --session $S click @eN                                    # Mention an agent
agent-browser --session $S snapshot -i                                  # the picker's options have refs
agent-browser --session $S click @eM                                    # pick an agent
agent-browser --session $S fill @eK "@<agent> hi"                       # the Message box
agent-browser --session $S wait --text "hi" --timeout 60000
agent-browser --session $S get text "[data-component=chat-transcript]"
```

Backend proof: `bun kiko verify agents --url ...`, `team-routing`, `team-ask`, `workers`. Those suites need a model key for the `-model` variants.

## Gotchas

- A worker is not a room member. It does not appear in the member list.
- Refs change when the picker opens. Re-snapshot.
- Tagging the wrong name sends the message to the lead, so check which agent replied.
- Several agents answering at once is a race. Give each reply a stable text to wait for.
- Do not put a wait on another agent inside your own run. It deadlocks (AGENTS.md).
