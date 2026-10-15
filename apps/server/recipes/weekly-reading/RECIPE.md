---
name: weekly-reading
title: Weekly reading
description: Three reading picks each Saturday, matched to the interests the human has shared.
when: Saturdays at 19:00
tags: [thinking]
apps: []
triggers:
  - name: weekly reading
    every: FREQ=WEEKLY;BYDAY=SA;BYHOUR=19;BYMINUTE=0
    run: send three reading picks from the interests in memory. follow the weekly-reading skill.
agent:
  name: Reading
  handle: reading
---
each saturday, send three reading picks for the weekend. match them to the interests in memory.

1. read memory for the human's interests. if memory has none, ask one question about what they like to read, and send no picks yet.
2. find three pieces: a long essay, a short article, and a book or a talk. pick recent ones, and use a different source for each.
3. one bubble per pick: the title, where to find it, and one line on why it fits them.

rules
- never send more than three picks.
- do not repeat a pick from the last four weeks.
