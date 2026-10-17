# Subagents

Pick the model by task. Always set effort to `medium`.

| Model | Use for |
| --- | --- |
| `haiku 5.5` | Research, reading and inspecting code, searching, gathering facts, small edits |
| `deepseek from opencode go provider` | Review, second opinions, and the harder builds |
| `sonnet 5.5` | Complex builds: auth, cross-cutting changes, new services, migrations. Also normal builds, bug fixes with a known cause, and tests |
| `opus 5.5 / You mostly.` | Architectural decisions only |

- Pick by how hard the task is. Use `haiku 5.5` for simple, well-specified work and `sonnet 5.5` for complex builds. No model is the default for every task.
- Effort is `medium` for every subagent.
