# Agent runtime (Haiku, read-only)
160 lines in 11 items (104 low risk, 56 medium).
Autonomous-run budget 39; deleted-agent guards and wipe entry points 34; run origin tracking 28 (with room chains); fake browse script 28; dev classic mode 11; devSeed 6; limits route 6; heartbeatMs option 3; micro 5.
DO: outbox end() marks ended and never deletes (unbounded); RESTARTS_KEY and BRIEF_KEY are rewritten on every batch with the same value; isWiped read on every call goes with the guards.
