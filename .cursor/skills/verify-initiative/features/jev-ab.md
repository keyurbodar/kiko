# Jev A/B cost

Compares background spend with the judge on and off for the same script.

## Sub-features

`setJev` toggle, `usage().memory` counters, `background()` sum.

## How to get to it (user POV)

Settings, add or remove the TypeSafe key.

## Driving it with kit.ts

Run `smoke.ts` and `smoke.ts --jev` (fresh user each, so counters start at zero). Compare `background tokens` and `agent usage`.

## Gotchas

Measured 2026-10-10 on one message: without Jev, background 0 tokens, agent input 7796; with Jev, background 1439 (capture_jev 1), agent input 7745. One sample is not a result: repeat and average. Capture settles a few seconds after the reply; wait before reading.
