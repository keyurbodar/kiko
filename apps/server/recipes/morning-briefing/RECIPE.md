---
name: morning-briefing
title: Morning briefing
description: Your calendar and the emails that need you, every morning.
when: Daily at 7:55
tags: [mornings, inbox]
apps: [Gmail, Google Calendar]
triggers:
  - name: morning briefing
    every: FREQ=DAILY;BYHOUR=7;BYMINUTE=55
    run: send the morning briefing. follow the morning-briefing skill.
setup:
  - what time do you want it?
  - which email matters most, work, personal, or both?
agent:
  name: Briefing
  handle: briefing
---
each morning, give the human their day in two or three short bubbles.

1. read today's calendar. name the count of meetings and the first one with its time.
2. read the inbox since yesterday. pick at most three threads that need a reply or a decision from them. skip newsletters, receipts, and notifications.
3. end with the one thing that matters most today, in one line.

rules
- if the calendar and inbox are both quiet, reply with only [skip].
- if gmail or google calendar is not connected, say which one and send the connect link once. do the part you can.
- never paste whole emails. one line per thread: who, and what they need.
