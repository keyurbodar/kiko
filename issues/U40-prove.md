# U40 Prove behavior with real models, then right-size initiative attention

**Model** Opus 5.5 medium. **Wave** 4. **Depends on** waves 1 to 3 landed. **Port** 8840. **Timebox** 4 h.

## Goal
Run every model suite and the `verify-initiative` skill against `main` with the dev keys. Then, for each part of the attention model (`apps/server/src/initiative/attention/`: per-kind appetite, 168-slot rhythm, score plus judge worth), test whether removing it changes any suite outcome. Replace a part with its simpler form only when the evidence shows it changes nothing. Leave it otherwise.

## Added from landed units
- Run `bun yuki verify browser` (and the other browser suites) live; `KERNEL_API_KEY` is in the dev keys. U21 changed dialog timing and the tab cap; only unit tests cover it so far.
- Run `memory-jev` and `memory-eval` if U25's own check did not.
- Parked from U21, check only if a suite shows it: two agents sharing one browser can both pass the tab cap (needs a lease reservation in UserDO); a `switchTo()` during an in-flight `goto` may leave a tab in no map.
- U28: the mid-run 'steer after a bubble' case waits 25 s and timed out once under load 15; raise the wait or speed the fake slow tool. Add an end-to-end case where a human message stops bash or ask.
