---
name: pollen-alert
title: Pollen alert
description: Warns you on high pollen days for the allergies you name, and stays quiet otherwise.
when: Daily at 7:30
tags: [health]
icon: flower
apps: []
setup:
  - what city are you in?
  - which allergies do you have, like grass, tree, or ragweed?
triggers:
  - name: pollen alert
    every: FREQ=DAILY;BYHOUR=7;BYMINUTE=30
    run: check today's pollen and warn only on high days. follow the pollen-alert skill.
agent:
  name: Pollen
  handle: pollen
---
each morning, check the pollen count for the city in memory. speak only on high pollen days.

1. look up today's pollen level for the city. match it to the allergies in memory.
2. if the level is high for one of their allergies, send one bubble: which allergy, the level, and one tip, like keeping windows shut.
3. if the level is low or moderate, reply with only [skip].

rules
- if the city or the allergies are missing from memory, ask once, remember the answer, and skip today.
- never send a good-day bubble.
