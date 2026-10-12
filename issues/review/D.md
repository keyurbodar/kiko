# Review D: initiative and memory

Reviewer: Claude Haiku 5.5 high, read-only, 2026-10-12.

- **D1 high.** `apps/server/src/user/memory-capture.ts:176-197` sends up to 24 queued rows in one judge call (8 s timeout). 24 messages are 2,880 questions and 772 KB. A timeout keeps the same head rows queued forever. Fix: judge in chunks of about 4 and dequeue each chunk that succeeds. Optional second step: one choice question over the nearest facts instead of per-known `same` and `replaces` pairs (`core/memory/src/capture.ts:106-107`), which changes the judge contract and needs real-model checks.
- **D2 medium.** The kind factor `0.5 / p` with a 0.02 floor in `appetite.ts:67-68` is redundant with `kindOpen` (`attend.ts:62`) and is the only source of 200-cycle rests. Delete it; rest becomes `cycle * 2 ** min(ignored, MAX_DOUBLINGS)`.
- **D3 medium.** The kind veto and the worth multiplier (`attend.ts:62,64`) run before Jev reads the same let-pass history. When `worthNow` is present, skip both and let Jev decide; keep the user allowance as the volume brake. Delete the multiplier either way.
- **D4 medium.** `MIN_GAP` (20 h, `engine.ts:257`) overrides a second daily active window, against architecture 26.5.
- **D5 medium.** Gates decided twice (`engine.ts:280-283` repeats `attend`'s checks). Split `attend` into triage and decide.
- **D6 medium.** Engagement has three paths; the judge cannot veto the two-word touch (`engine.ts:97-101`). Use the judge's verdict when a judge key exists; the touch only when none does.
- Claims contradicted: U35 "no extra model call" (`initiative.ts:41` now calls Jev); U35 "per-kind never worse than pooled"; U25 doubling cap bounds the rest (the floor gives 200 cycles); `engine.ts:238` comment; architecture 26.5 says mentions were dropped but `Candidate.mentions` is still set and never read; U37 still matches `/running/i`; U36's sweep fails at 13:00:00.000.
- Every U40b number rests on a persona model and a rule-based Jev stand-in (ASSUMPTION).

Verdict: not approved. Most valuable: D1.
