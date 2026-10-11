# U40 Prove behavior with real models, then right-size initiative attention

**Model** Opus 5.5 medium. **Wave** 4. **Depends on** waves 1 to 3 landed. **Port** 8840. **Timebox** 4 h.

## Goal
Run every model suite and the `verify-initiative` skill against `main` with the dev keys. Then, for each part of the attention model (`apps/server/src/initiative/attention/`: per-kind appetite, 168-slot rhythm, score plus judge worth), test whether removing it changes any suite outcome. Replace a part with its simpler form only when the evidence shows it changes nothing. Leave it otherwise.
