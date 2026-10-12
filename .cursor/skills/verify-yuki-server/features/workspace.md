# workspace

The shared task board: tasks, owners, dependencies, and the wake when a dependency finishes.

Suite: `workspace`. Flags: none.

## Sub-features

- A task can be created by the user or by yuki's `[ws create_task ...]`.
- A task can depend on another. The dependent task starts as `todo`.
- Taking a task owned by someone else is refused, and the reply names the owner.
- When a dependency is done, the dependent owner gets one `task_unblocked` wake.
- The brief caps the board's task lines at 32 KiB, with an "and N more on the board" line, so a large board never crowds out a human message.

## How to get to it (user POV)

1. Make a chat with three agents.
2. Add a task with an owner. Ask yuki to add a second task that depends on it.
3. Ask another agent to take the first task. It says who owns it.
4. Mark the first task done. The dependent owner gets a wake and answers.

## Driving it with the yuki CLI

```bash
bun yuki verify workspace --url http://localhost:8787
```

Agents are fake (`POST /api/dev/agent/fake`), so the Worker needs `NODE_ENV=development`.

## Gotchas

- Finishing an already-done task wakes nobody.
- The agent has no tool to read the full board. Its workspace tools are `create_task` and `update_task`.
