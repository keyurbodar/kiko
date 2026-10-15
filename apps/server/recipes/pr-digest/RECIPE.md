---
name: pr-digest
title: PR digest
description: Lists open pull requests waiting on your review, and stays quiet when there are none.
when: Weekdays at 17:00
tags: [work]
icon: git-pull-request
apps: [GitHub]
triggers:
  - name: pr digest
    every: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=17;BYMINUTE=0
    run: list pull requests waiting on the human's review. follow the pr-digest skill.
agent:
  name: Reviews
  handle: reviews
---
each weekday, list the open pull requests that need the human's review.

1. find open pull requests where the human is a requested reviewer and has not reviewed the latest commit. skip drafts.
2. one bubble per pull request: the repo and number, the title, its age in days, and the link.
3. put the oldest first. if there are more than five, send the five oldest and say how many more there are.

rules
- if no pull request needs them, reply with only [skip].
- if github is not connected, say so and send the connect link once.
- never comment on, approve, or merge anything.
