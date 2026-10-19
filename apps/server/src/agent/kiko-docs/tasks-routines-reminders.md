# Tasks, routines, and reminders

## Tasks

The chat's task board tracks meaningful steps, not tool calls. The human sees it in a tray above the message box.

- `create_task {title, owner?, depends_on?}` adds one. The title names an action, in about twelve words at most. Details belong in the handoff message or the files, not the title.
- `update_task {id, status, note?, title?}` changes one. Statuses are `doing`, `done`, `blocked`, and `review`.
- Setting `doing` takes a task nobody owns.
- Set `doing` before you start, `done` after you check the result, `blocked` with a concrete reason when stuck, and `review` only when the lead must look.
- `depends_on` holds task ids that must finish first. A task assigned to another member wakes that member when it is ready, and when its dependencies finish.
- Review, done, and blocked notify the lead by themselves. Do not send a duplicate status.
- When the lead gets a task in review, check it and either mark it done or return specific feedback.

Never ask the human to maintain statuses. A simple reply needs no task.

## Routines

`create_routine` gives an agent a job that runs on its own. A teammate answers here; an agent outside this chat answers in its own chat. Use it whenever the human wants something repeated or scheduled. Saying "got it" sets nothing.

A trigger is one of these:

- `{on: "time", at: "<iso with offset>"}` runs once at that time. `{on: "time", in_seconds: 600}` is the same, counted from now.
- `{on: "time", at: "<next 08:30 with offset>", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"}` repeats on a schedule. The `at` is the first run; the `rrule` gives the rest. A schedule repeats at most every 30 minutes.
- `{on: "message", contains?}` runs when the human posts here. Agent messages never match. Never make one of these to talk with another agent: use `send_message`.
- `{on: "webhook", match?: [{path, equals | contains}]}` runs when an outside service posts to its url.

Use the timezone on the now line. It is UTC when the human never set one; say which zone you used rather than asking first.

The live routine inventory in `<context>` is current. Kiko can manage every routine owned by the human. Other agents can manage this chat's routines and jobs assigned to themselves in any chat.

`list_routines` shows instructions, state, schedule, and the last run. `update_routine` changes, reschedules, pauses, resumes, or runs a job now. A completed one-time job needs an explicit future trigger to run again. `cancel_routine` stops a job and is safe to repeat.

## Reminders

A reminder is a routine that runs once and says one thing. Make it the same way: a `time` trigger and instructions that say what to tell the human. Do not add a `rrule`.

## Recipes

A recipe is a saved routine, owned by the human, in `/home/recipes/<name>/RECIPE.md`. `add_recipe {slug}` sets one up in this chat and makes its routines at once. Recipes are listed with your skills. See /kiko/recipes.md.
