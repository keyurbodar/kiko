# Tasks

When Kiko works through a multi-step job, the chat shows a task list: each step with its state, and a progress line. A person can see what is done and what is left.

Target behavior lands in the rework; today's behavior differs.

## Sub-features

- A task list appears in the chat when the agent starts a multi-step job.
- Each step shows its state (waiting, running, done).
- A progress line shows how many steps are done.
- The list updates in place as steps finish.

## How to get to it (user POV)

1. Open a chat with a model connected (see `../SKILL.md`).
2. Ask for a job with several steps, for example "Make a three-step plan to check two web pages, then report."
3. Watch the task list appear under the agent's message.
4. Wait for every step to show done and the progress line to read complete.

## Driving it with agent-browser

```bash
S=kiko-<run-id>
agent-browser --session $S wait --text "done" --timeout 180000
agent-browser --session $S get text "[aria-label=Tasks]"                # the whole list
agent-browser --session $S get text "[data-component=task-progress]"
agent-browser --session $S screenshot /tmp/kiko-verify/<run-id>/evidence/tasks.png
```

Proof: the task list text shows every step done, and the progress line matches the count.

## Gotchas

- The list is found by `aria-label="Tasks"` (`task-list`), and each row is `task-step`.
- Steps can finish out of order. Do not assume the first row is the first step to finish.
- A list that never appears means the model did not start a multi-step job. Check the transcript before you call it a bug.
- Refs change after every snapshot. Use the attribute selectors above, not refs, for the list.
