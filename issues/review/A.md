# Review A: room delivery and pacing

Reviewer: Claude Haiku 5.5 high, read-only, 2026-10-12. Reviewed `main` and branch `s/u52-no-resend` at round 3 (A7 order and A10 frame measure were then fixed in round 4).

Holds: U12; U25 room parts. U27 holds in part.

- **A1 blocker (U52).** Routing reads `e.body` (`burst-flush.ts:82`), which is the 16,000-character bubble. An `@ada` after character 16,000 goes to the lead. Fix: store the mention tags of the full text on the pending row at send time; `route` uses them. Proof: 20,000 characters with `@ada` at the end reach ada.
- **A2 blocker (U52).** The branch deletes the human refusal notice claiming the entry always fits. It does not: 16,000 U+001B characters are 96,000 JSON bytes; with the 32,768-byte board cap that leaves 2,304 bytes for the envelope, goal, human line and member lines. Fix: keep a per-envelope human notice worded without asking for a resend, cap the bubble in JSON bytes, size the board to fit, and delete the notice only after a test proves the bound with the worst case (`"\u001b".repeat(16000)`, board at cap, 3 members with 400-character roles).
- **A3 high (main).** `admit` refuses the whole delivery if one envelope is too large; `REFUSED.human` notifies only `raw[0]`; the rest vanish. Fix: one notice per envelope with the existing `refused:<envelope>:<slug>` key. Reword without "send a shorter one".
- **A4 high (main, regression from U27).** `mail.ts:162,176` records `agent_sends` in one transaction and `mail-drain.ts:43,51-54,74-77` queues in another. A throw between them (e.g. `publish`) loses the message: the replay sees `fresh: false`. Fix: insert queue rows in the same `transactionSync` in `Mail.send` and `Mail.relay`; delete the `fresh` gate and the separate queue calls. Split `send(askId: string | null)` into `ask` and `message`.
- **A5 high (U52).** A held over-limit burst larger than one delivery: `flush` calls `retry(0)` after the limit path set the reset alarm; `setWakeup` overwrites, so it spins until the reset. Fix: the limit path returns `held`; no `retry(0)`.
- **A6 high (U52).** A held burst keeps `pending()` true until reset, so initiative wakes return busy and agent mail to its recipients is held through `burstAddressed`, for up to a day. Fix: held rows do not count as pending (a `held_until`).
- **A8 medium (main).** `stop` (`room-do.ts:702-705`) clears the burst, deleting human messages still in the debounce window with no delivery and no notice.
- **A9 medium (main).** `AgentDO.receive` calls `answers.interrupt()` before admission; a refused human envelope still ends an ask wait. (Same as B07.)
- **A11 medium.** `Home` declared in seven room files; `AgentHome`, `MAIL_WAKEUP`, `pushAnswer` duplicated between `room-do.ts` and `mail-drain.ts`; unused `markReactionsBriefed` import.
- **A12 medium.** One `receive` wired into four objects in three shapes (`room-do.ts:146,149,160,175-185`, `wake-delivery.ts:39`). One `Receiver`.
- **A13 medium.** `burst-flush.ts:63-64` two ordering paths; a turn is charged even when the chat is gone. One serial path.
- **A14 medium (U52).** `room-do.ts` grows to 994 lines; move `fileIdOf`, `bubbleOf`, whole-text constants, `writeWhole` into `room/whole-text.ts` with direct tests; delete the orphan R2 object on `ClaimRefused`.
- **A15 medium.** No test calls `deliverWake` or `retryHeld`; `refundAutonomous` is never exercised.

Verdict: not approved. Most valuable: every human message ends in an outcome the human can see (A1, A2, A3).
