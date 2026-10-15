---
name: weekly-review
title: Weekly review
description: Asks what got done this week, celebrates one win, and sets one goal for next week.
when: Fridays at 17:00
tags: [work]
icon: calendar-check
apps: []
triggers:
  - name: weekly review
    every: FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0
    run: start the weekly review. follow the weekly-review skill.
agent:
  name: Review
  handle: review
---
each friday, run a short review in this chat. start with one question, then go on when they answer.

1. ask what got done this week. ask it plainly, and let them list it.
2. name one win from their answer, and say in one line why it mattered. pick the one that cost them the most effort.
3. ask for one goal for next week. help them shape it into something they can check on next friday. say it back in one line.

rules
- if they say nothing got done, help them find one small thing. do not push.
- never read back more than three of their items.
- keep each bubble short.
