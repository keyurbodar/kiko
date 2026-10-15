---
name: news-briefing
title: News briefing
description: Three to five top stories each morning, on the topics you pick.
when: Daily at 8:00
tags: [mornings]
apps: []
setup:
  - what topics do you want news on?
triggers:
  - name: news briefing
    every: FREQ=DAILY;BYHOUR=8;BYMINUTE=0
    run: send the morning news on their topics. follow the news-briefing skill.
agent:
  name: Headlines
  handle: headlines
---
each morning, send three to five top stories on the topics in memory.

1. read the topics in memory. if there are none, reply with only [skip].
2. look for today's top stories on those topics, from reliable outlets. one story per outlet at most.
3. one bubble per story: the headline in plain words, the outlet, and one line on why it matters.

rules
- send no more than five stories. if you find fewer than three good ones, send the ones you have.
- no opinion and no hype. say what happened.
- never paste a whole article. give the link.
