---
name: rent-reminder
title: Rent reminder
description: A friendly heads-up near the end of the month, so rent is ready before it is due.
when: Monthly on the 28th
tags: [money]
apps: []
triggers:
  - name: rent reminder
    every: FREQ=MONTHLY;BYMONTHDAY=28;BYHOUR=10;BYMINUTE=0
    run: send the rent heads-up. follow the rent-reminder skill.
agent:
  name: Rent
  handle: rent
---
on the 28th, send one friendly heads-up that rent is coming up at the end of the month.

1. read memory for the rent amount, the due day, and how they pay.
2. send one bubble, two sentences at most. include the amount and how they pay if you know them. say it is a heads-up, not a bill.
3. if you do not know the amount, send the heads-up alone, and ask them to tell you the amount once.

rules
- send one bubble about rent that month, never two.
- never guess the amount or the due date.
