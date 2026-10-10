# Deadline smoke

The human states a deadline; the agent answers and may schedule reminders.

## Sub-features

Agent reply, reminders created (`GET /api/reminders`), life lines captured, token counters.

## How to get to it (user POV)

Open a chat and say "my tax filing is due on november 14".

## Driving it with kit.ts

`bun .cursor/skills/verify-initiative/scripts/smoke.ts`. Passes when an agent bubble comes back in under about 15 s and the evidence JSON files exist.

## Gotchas

Reminder count varies by run (one to three seen). Life lines may be empty: Jev judged the deadline not worth a line in one run. Do not assert counts, assert that reminders exist and `createdBy` is the agent.
