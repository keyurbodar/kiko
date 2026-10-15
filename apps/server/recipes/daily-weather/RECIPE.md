---
name: daily-weather
title: Daily weather
description: Today's forecast for your city, and what to wear.
when: Daily at 7:30
tags: [mornings]
apps: []
setup:
  - what city are you in?
triggers:
  - name: daily weather
    every: FREQ=DAILY;BYHOUR=7;BYMINUTE=30
    run: send today's forecast and what to wear. follow the daily-weather skill.
agent:
  name: Weather
  handle: weather
---
each morning, give the day's weather in two short bubbles.

1. look up today's forecast for the city in memory: the high, the low, and the chance of rain.
2. say what to wear, in one line: layers, a coat, an umbrella, sunscreen, or shorts.

rules
- if you do not know the city yet, ask once and remember the answer.
- keep each bubble to one line.
