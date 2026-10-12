# Review C: user object, deletion, routines, reminders, wipe

Reviewer: Claude Haiku 5.5 high, read-only, 2026-10-12. Ran `reminder-rules`, `wipe-order`, `delete-account`, `routines-hooks`: 27 pass. Three scratch probes against the real modules.

## Open questions settled

- One-off count cap: absent. `Reminders.create` (`reminders.ts:224-262`) has no count check. The only count cap is `MAX_ROUTINES` (`281-284`), which filters `trigger IS NOT NULL`. A probe stored 1000 one-offs.
- Snooze horizon: absent. `snooze` (`529-542`) only runs `parseTime` (`119-124`). A probe snoozed to `9999-12-31` and it was stored as `active`.

## Does U26 overclaim

Mostly no. Two overstatements: "one-off cap" in the mutation line (`U26-userdo.md:47`) and decisions row 48 is an attempt cap (three failures then `failed`), not a count cap. "Refused runs count" covers only the returned `refused`, not a thrown delivery. Webhook rows on chat delete drop through `waitUntil`, not in the same step, with no test.

## Findings

- **C1 high.** `jobs/delete-account.ts` `enqueueDeletion` (sendBatch ~101), `startDeletion` (abort ~122), `auth/account-route.ts:78-83`. A 503 from a failed enqueue does not stop jobs already queued; they close and wipe rooms on a live account. Fix: generation stamp on every job, checked by `runDeleteJob`; `cancelDeletion` clears it. ~12 lines. Proof: the fake `enqueue` in `delete-account.test.ts:150-152` already queues a partial job; run it after the abort; today room A is removed.
- **C2 medium.** `user-do.ts:851-853` `beginDeletion` wipes Kernel before enqueue. Irreversible on rollback. Move `kernel.wipe()` into `deleteAll`'s final step (`876-878`).
- **C3 medium.** `account-route.ts:79-82` abort calls `cancelDeletion()` then `restoreUser()`; if the first throws the tombstone stays and the user is locked out. Restore first.
- **C4 medium.** `reminders.ts:455-461` a thrown delivery skips `finishRun`; `fails` never rises. Time routines retry every 30 s for an hour then skip silently; watch routines retry unbounded. Probe: `calls: 5, status: active, fails: 0`. Fix: `.catch(() => "refused" as const)`.
- **C5 medium.** `core/durable/src/wipe.ts:20` `storedRows` returns 0 for any finished wipe; `:27` counts the marker key. Tests `wipe-tombstone.test.ts:45`, `wipe-order.test.ts:62` are true by construction.
- **C6 medium.** One-off count cap missing (see above).
- **C7 medium.** Snooze has no horizon.
- **Q1 medium.** `user-do.ts:71` separate `DELETING` key next to the wipe marker; the compound guard is repeated at 726, 829, 844. Fold into one state in `wipe.ts`. Hazard: `beginDeletion` returns `[]` when wiped; a retry must still get the rooms list.
- **Q2 medium.** `reminders.ts:429-432` and `545-553` are one transition (count failure, terminal status at `MAX_FAILS`, one notice). One `countFailure(reminder, to)`.
- **Q3 medium.** `reminders.ts:347-348` mints a webhook token on every patch; `511-521` `rowOf`/`putRow` is a generic row restorer for one caller.
- Outside the diff: `hooks-route.ts:23-44` duplicates `router.ts:34-58` `readCapped`.

Verdict: not approved. Most valuable: C1, with C4 in the same change.
