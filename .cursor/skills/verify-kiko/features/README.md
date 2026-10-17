# Kiko features

One file per user-facing feature. Each file says how to reach the feature as a person would, how to drive it with `agent-browser`, and what goes wrong.

| Feature | File | Status |
| --- | --- | --- |
| Chat and pacing | [chat-and-pacing](./chat-and-pacing.md) | Sending and replies work today. Pacing is target behavior. |
| Model switch | [model-switch](./model-switch.md) | Target behavior lands in the rework; today's behavior differs. |
| Errors | [errors](./errors.md) | Target behavior lands in the rework; today's behavior differs. |
| Browser | [browser](./browser.md) | Target behavior lands in the rework; today's behavior differs. |
| Workers and teams | [workers-and-teams](./workers-and-teams.md) | Target behavior lands in the rework; today's behavior differs. |
| Tasks | [tasks](./tasks.md) | Target behavior lands in the rework; today's behavior differs. |

Every feature file has these H2 sections: `Sub-features`, `How to get to it (user POV)`, `Driving it with agent-browser`, `Gotchas`.

Before you drive a feature, run `bin/up.sh` and connect a model (see `../SKILL.md`). Save evidence under the run's `evidence/` directory.
