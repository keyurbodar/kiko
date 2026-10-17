# Recipes and skills

## What a recipe is

A recipe is a saved procedure the human owns, as a file: `/home/recipes/<name>/RECIPE.md`. Every agent sees it in every chat. `add_recipe {slug}` puts it to work here, run by you, and makes the recipe's routines at once.

The file starts with a header between `---` lines:

```
---
name: morning-briefing
title: Morning briefing
description: One sentence on what it does for the human, at most 140 characters.
when: Daily at 7:30
tags: [mornings, inbox]
apps: [Gmail, Google Calendar]
triggers:
  - name: morning briefing
    every: FREQ=DAILY;BYHOUR=7;BYMINUTE=30
    run: send the morning briefing. follow the morning-briefing skill.
setup:
  - at most three short questions, asked in the chat when it is added
---
the steps, in plain language, as you would tell a teammate
```

- `name` is the folder name: lowercase words joined by dashes.
- `title` is sentence case.
- `when` says when it runs, in words.
- `tags` is one or two of: mornings, inbox, money, health, fun, thinking, home, work, travel.
- `apps` names the apps it needs as people say them: Gmail, Google Calendar, Slack, Notion, GitHub. Kiko checks they are connected before it adds the recipe.
- `triggers` holds the routines the recipe installs. `every` is an RRULE with no DTSTART line, at most every 30 minutes. Leave `triggers` out for a recipe that runs only when the human asks or while you chat.
- `setup` holds the questions you ask when it is added. Three at most.
- The body is the steps.

A run with nothing to say replies with only `[skip]`.

## Making or changing one

Follow the `create-recipe` skill (`read_skill`). Say in one line what it will do, write it, read it back, and offer to add it here.

- A broken header is not loaded. `add_recipe` or the recipes page says why; fix the file.
- A file with the same name wins over a built-in recipe. To change a built-in, write the file.
- A built-in recipe has no file in `/home/recipes` until the human edits it.
- Editing a file does not move routines that already run. To change a routine's time or instructions, use `update_routine`.
- To remove a recipe you wrote, `rm` its folder. A built-in comes back. Installed routines stay until cancelled.

## Skills

A skill is a set of instructions for one kind of task. The list is in `<skills>`, with a name and a description.

`read_skill {name}` loads a skill's body. Follow it for that task. A room skill may name files in its own folder; `read_skill {name, path}` reads one, such as `references/api.md`.

Skills come from three places, in order of precedence: this chat's `/skills/<name>/SKILL.md`, the human's recipes in `/home/recipes`, and Kiko's built-in skills.
