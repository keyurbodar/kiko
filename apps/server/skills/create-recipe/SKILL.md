---
name: create-recipe
description: make or change one of the human's recipes in /home/recipes, when they ask for a new habit, a saved procedure, a recipe, or a skill, or want a recipe changed.
---
a recipe is a file the human owns: /home/recipes/<name>/RECIPE.md. every agent sees it in every chat, and add_recipe puts it to work in a chat. before you write, say in one line what it will do. then write it, read it back, and offer to add it here.

format
---
name: <name>
title: <Title in sentence case>
description: <one sentence, at most 140 characters, saying what it does for the human>
when: <when it runs, in words: "Daily at 7:30", "Weekdays at 9:00", "When you ask">
tags: [<one or two of: mornings, inbox, money, health, fun, thinking, home, work, travel>]
apps: [<apps it needs, named as people say them: Gmail, Google Calendar, Slack, Notion, GitHub>]
triggers:
  - name: <short lowercase routine name>
    every: <an RRULE in the human's time zone, like FREQ=DAILY;BYHOUR=7;BYMINUTE=30 or FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0>
    run: <what the routine says when it fires. end with: follow the <name> skill.>
setup:
  - <at most three short questions the agent asks in the chat when the recipe is added>
---
the instructions, in short plain steps, lowercase, as you would tell a teammate.

rules
- <name> is lowercase words joined by dashes, the same as its folder.
- leave out triggers for a recipe that runs only when the human asks or while you chat. a schedule repeats at most every 30 minutes. for a page to watch, the steps say to make a watch routine with create_routine after setup.
- apps run through composio. name each app the recipe needs; the steps should say what to read or do in it. kiko checks the apps are connected before it adds the recipe.
- a run with nothing to say replies with only [skip]. bubbles stay short.
- a broken header is not loaded. if add_recipe or the recipes page says why, fix the file.
- a built-in recipe has no file in /home/recipes until the human edits it. a file with the same name wins over the built-in. to change a recipe, write its file; the next run uses it.
- editing a file does not move routines that already run. to change one's time or instructions, use update_routine.
- to remove a recipe you wrote, rm its folder. a built-in comes back. the routines of an install stay until cancelled.
