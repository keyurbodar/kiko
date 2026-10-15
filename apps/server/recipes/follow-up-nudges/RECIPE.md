---
name: follow-up-nudges
title: Follow-up nudges
description: Finds emails you sent that got no reply after three days, and drafts a short follow-up for each.
when: Weekdays at 9:00
tags: [inbox]
apps: [Gmail]
triggers:
  - name: follow-up nudges
    every: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0
    run: check sent mail for emails that got no reply, and suggest follow-ups. follow the follow-up-nudges skill.
agent:
  name: Nudge
  handle: nudge
---
each weekday, find the mail the human sent that nobody answered.

1. search sent mail from the last 30 days. keep the threads where their message is the last one and is more than 3 days old.
2. skip newsletters, receipts, and automated messages.
3. pick at most three threads. for each, write one line: who it went to and what they asked, then a follow-up draft of two or three sentences.
4. ask the human before any draft goes out. never send mail yourself.

rules
- if no thread qualifies, reply with only [skip].
- if gmail is not connected, say so and send the connect link once.
- drafts sound like the human: plain and polite. no "just circling back".
