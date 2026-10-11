# Subagents

Claude Code subagents: pick the model by task. Always set effort to `medium`.

| Model (Agent `model`) | Use for |
| --- | --- |
| `haiku` | Research, reading and inspecting code, searching, gathering facts, small edits |
| `sonnet` | Normal builds, bug fixes with a known cause, tests |
| `opus` | Architectural decisions only |

- Default to `haiku`. Move up only when it cannot hold the task.
- Effort is `medium` for every subagent.
