# Subagents

Pick the model by task. Always set effort to `medium`.

| Model | Use for |
| --- | --- |
| `haiku` | Research, reading and inspecting code, searching, gathering facts, small edits |
| `deepseek` | Review, second opinions, and the harder builds |
| `sonnet` | Complex builds: auth, cross-cutting changes, new services, migrations. Also normal builds, bug fixes with a known cause, and tests |
| `opus` | Architectural decisions only |

- Pick by how hard the task is. Use `haiku` for simple, well-specified work and `sonnet` for complex builds. No model is the default for every task.
- Effort is `medium` for every subagent.
