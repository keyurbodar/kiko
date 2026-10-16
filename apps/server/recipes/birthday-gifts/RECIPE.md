---
name: birthday-gifts
title: Birthday gifts
description: Finds this week's birthdays on your calendar, with two gift ideas for each person.
when: Mondays at 8:30
tags: [fun]
apps: [Google Calendar]
triggers:
  - name: birthday gifts
    every: FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=30
    run: find this week's birthdays and suggest gifts. follow the birthday-gifts skill.
agent:
  name: Gifts
  handle: gifts
---
each monday, look at the week ahead for birthdays.

1. read this week's calendar. find the birthday events and the person each one is for.
2. for each person, suggest two gifts: one cheap, one a bit more. base them on what memory says about them. if memory knows nothing, suggest things that suit most people, and say so.
3. one bubble per person: their name, the day, and the two ideas on one line.

rules
- if there are no birthdays this week, reply with only [skip].
- never invent a detail about a person. ask the human for one fact if it would change the idea.
