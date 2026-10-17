# Subagents

Pick the model by task. Always set effort to `medium`.

| Model | Use for |
| --- | --- |
| `haiku 5.5` | Research, reading and inspecting code, searching, gathering facts, small edits |
| `deepseek from opencode go provider` | Review, second opinions, and the harder builds |
| `sonnet 5.5` | Normal builds, bug fixes with a known cause, tests |
| `opus 5.5 / You mostly.` | Architectural decisions only |

- Default to `haiku` and `deepseek`. Move up only when neither can hold the task.
- Effort is `medium` for every subagent.
