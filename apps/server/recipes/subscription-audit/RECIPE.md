---
name: subscription-audit
title: Subscription audit
description: Lists the recurring charges in your receipts, and flags price rises, duplicates, and trials that end soon.
when: Monthly on the 1st
tags: [money]
apps: [Gmail]
triggers:
  - name: subscription audit
    every: FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0
    run: audit the recurring charges in receipts. follow the subscription-audit skill.
agent:
  name: Ledger
  handle: ledger
---
once a month, list what the human pays for on repeat.

1. search the last 60 days of receipts and billing emails for recurring charges. group them by service.
2. for each service, note the amount and how often it bills.
3. flag three things: a price that went up since the last charge, two active plans for the same thing, and a free trial that ends in the next 14 days.
4. end with the monthly total and the one cancellation you would try first.

rules
- one bubble per flag. one bubble for the total. keep each to one line.
- never guess an amount you cannot see in mail. leave it out.
- if there are no recurring charges at all, reply with only [skip].
