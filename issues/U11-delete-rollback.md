# U11 Account deletion survives a failed enqueue

**Model** Sonnet 5.5 medium. **Wave** 1. **Depends on** nothing. **Timebox** 75 min.

## Goal
If queuing the deletion fails, the user can try again and nothing is half-deleted.

## Context
`apps/server/src/auth/account-route.ts:66-68` runs `revokeUser`, `UserDO.beginDeletion`, then `enqueueDeletion` with no rollback. Line 57 answers 401 to a tombstoned user, so a retry never reaches deletion, and the data stays forever. `apps/server/src/jobs/delete-account.ts:96-103` sends in chunks, so a mid-send failure leaves some rooms unqueued. `userId` is never checked with `checkUser` (`apps/server/src/lib/names.ts`) at enqueue, so a bad id would loop through the dead-letter queue.

## Build
Find the simplest order that converges. Candidates: enqueue before tombstoning (jobs are idempotent and tolerate a live user?), or tombstone, enqueue, and on failure clear the tombstone and the DELETING flag and answer 503. Read `delete-account.ts` and `UserDO.beginDeletion` to decide which one is actually safe, and say why in the report. Run `checkUser` before enqueue.

## Scope
`apps/server/src/auth/account-route.ts`, `apps/server/src/jobs/delete-account.ts`, `apps/server/src/user/user-do.ts` (only the deletion methods), `apps/server/src/auth/auth.ts` if the tombstone helper lives there, and `apps/server/test/delete-account.test.ts`.

## Acceptance
A test where the queue send throws: the route answers an error, the user can sign in and retry, and the retry completes deletion. It fails on today's code.

## Report

Chose rollback over enqueue-first. Enqueue-first lets jobs wipe data and delete the auth rows while the user is still live and can write, and `beginDeletion` also closes sockets and wipes the Kernel account, which must happen under the tombstone. So the route tombstones, queues, and on any failure calls `abort` (UserDO `cancelDeletion` clears DELETING and re-arms the alarm, then the D1 tombstone row is deleted; D1 last so the user stays blocked until the object is ready) and answers 503. Sessions were revoked, so the user signs in again and retries.

`deletion_rooms` is deliberately kept on rollback. `runDeleteJob` wipes the user when `roomDeleted` reports an empty ledger, so clearing it would let an already queued job from a partial send delete the whole account. Kept, those jobs only remove rooms the user asked to delete, and the retry's `INSERT OR IGNORE` re-adds the rest.

`userStub` (which runs `checkUser`) is now built before `revokeUser`, so a bad id answers 400 before any state changes. No change to `names.ts`.

Test: `startDeletion` in `delete-account.test.ts`. With the abort call removed, "a failed queue send leaves no tombstone..." fails (`expect(received).toBe(expected)`).
