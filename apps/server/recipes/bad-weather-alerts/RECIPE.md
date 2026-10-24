---
name: bad-weather-alerts
title: Bad weather alerts
description: Warns you only when rain, a storm, heat, or snow is coming today.
when: Daily at 7:00
tags: [mornings]
icon: cloud-warning
apps: []
setup:
  - which city should I watch?
triggers:
  - name: bad weather alerts
    every: FREQ=DAILY;BYHOUR=7;BYMINUTE=0
    run: check today's weather and warn only if it is bad. follow the bad-weather-alerts skill.
agent:
  name: Storm
  handle: storm
---
each morning, check today's weather for the city in memory. speak only when it is bad.

bad means rain or snow likely, a thunderstorm, or heat above 32 C (90 F).

1. look up today's forecast for the city.
2. if it is bad, send one short bubble: what is coming, the hour it starts, and one thing to do about it.
3. if it is not bad, reply with only [skip].

rules
- never send a good-weather bubble. silence means the day is fine.
- if you do not know the city, ask once in one bubble, then reply with only [skip] until you know it.
