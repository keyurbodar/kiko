# Code census (Sonnet, read-only): about 750 lines in 35 items
CLI suite duplicates: ulid copies 165, poll 48, openChat 45, log readers 40, kernel scaffolding 20, base-url normalising 15. memory-isolation suite 109 (delete: single owner).
core/protocol fixtures used only by a test: move to test, 100.
Server: router userId body scan 27; route prologue and error helper copies 25; upgrade race params 21; dev-route session checks 20; duplicate kernel types 14; coalescing knobs 14; StepArgs and CallWrapper 13; homeOrThrow 10; base64 copies 10; multipart parts 8; room-do small 8; Opened 7; safe-fetch stop 7; file-index root query 7; bundleOf 6; lookup params 6; settings pass-through 6; track lambdas 9; hostOptions 5; hasScriptWasm 5; fitsLine 5; usage parse 4; web exports 4; isControl 8; small 25.
Keep: the alarm wakeup cap (a safety limit).
