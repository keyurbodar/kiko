---
description: Run one kiko plan task from start to pull request
argument-hint: <task id, for example P0-05>
---

The task id is `$ARGUMENTS`.

Find its row in `tasks.tsv`. The `issue` column is the path of the issue file. Read that file and treat it as the attached issue.

Then follow the prompt in `docs/task-prompt.md` exactly.

If `$ARGUMENTS` is empty or matches no row, stop and say so.
