# Subagents

Pick the model by task. Always set effort to `medium`.

| Model | Use for |
| --- | --- |
| `haiku` | Research, reading and inspecting code, searching, gathering facts, small edits |
| `deepseek` | Review, second opinions, and the harder builds |
| `sonnet` | Normal builds, bug fixes with a known cause, tests |
| `opus` | Architectural decisions only |

- Default to `haiku` and `deepseek`. Move up only when neither can hold the task.
- Effort is `medium` for every subagent.
