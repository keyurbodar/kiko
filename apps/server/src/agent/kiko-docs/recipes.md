# Recipes and skills

## What a recipe is

A recipe is a saved procedure the human owns, as a file: `/home/recipes/<name>/RECIPE.md`. Kiko also ships built-in recipes in `/kiko/recipes/`. `add_recipe {slug}` puts one to work in this chat, run by you, and makes its routines at once. A recipe added here is listed in `<skills>`.

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

Follow the `create-recipe` skill. Say in one line what it will do, write it, and offer to add it here.

- A broken header is not loaded. `add_recipe` or the recipes page says why; fix the file.
- Kiko's built-in recipes are read-only files in `/kiko/recipes/<name>/RECIPE.md`. A file with the same name in `/home/recipes` wins over the built-in. To change a built-in, copy it there and edit the copy.
- Editing a file does not move routines that already run. To change a routine's time or instructions, use `update_routine`.
- To remove a recipe you wrote, `rm` its folder. A built-in comes back. Installed routines stay until cancelled.

## Skills

A skill is a set of instructions for one kind of task: a folder with a `SKILL.md` file. The file starts with a header between `---` lines with `name` (the folder name) and `description` (what it does and when to use it), then the instructions. Paths in it are relative to its folder, so a skill can keep more files, such as `references/api.md`.

The `<skills>` section lists each skill with its name, description, and location. When a task matches one, read its location and follow it.

- `/home/skills/<name>/SKILL.md` holds the human's own skills, the same in every chat. To make a skill, write one there.
- `/kiko/skills/<name>/SKILL.md` holds Kiko's built-in skills. A skill in `/home/skills` with the same name wins.
- A recipe added to this chat is listed as a skill too, at its `RECIPE.md`.
