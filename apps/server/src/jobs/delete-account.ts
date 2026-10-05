import { isRoomId, type RoomId } from "@kiko/protocol"
import type { Env } from "../index"
import { agentStub, roomStub, userStub } from "../lib/names"

// Account deletion fan-out. Architecture section 7.9.
//
// The account route first writes the tombstone and revokes every session (auth.ts), so
// no route or socket reaches the user's objects again. Then it asks `UserDO` for its
// rooms, every room ever addressed and not only chats, and enqueues one job per room, or
// one job with `roomId: null` when there are none. A room job closes its sockets, deletes the room's R2 objects,
// wipes each agent the room lists, wipes the room, and reports back to `UserDO`. The job
// that reports the last room finishes the account: it wipes `UserDO`, sweeps any R2
// object left under the user's prefix, and deletes the D1 rows last.
//
// Every step is safe to run twice. A wiped object answers with nothing, and a missing
// R2 key or D1 row is not an error. So a job that fails halfway completes on retry, and
// a second run of a finished job deletes nothing and reports zeros.

export type DeleteAccountJob = { kind: "delete-account"; userId: string; roomId: RoomId | null }

export function isDeleteAccountJob(body: unknown): body is DeleteAccountJob {
	if (!body || typeof body !== "object") return false
	const b = body as Record<string, unknown>
	return b.kind === "delete-account" && typeof b.userId === "string" && (b.roomId === null || (typeof b.roomId === "string" && isRoomId(b.roomId)))
}

/** What one run removed. A repeat of a finished job reports all zeros. */
export type DeleteReport = {
	/** Objects (agents, rooms, the user) that still held data. */
	agents: number
	rooms: number
	user: number
	/** R2 objects deleted. */
	objects: number
	/** D1 rows deleted: sessions, accounts, and the user. */
	authRows: number
	/** True when this run finished the account. */
	finished: boolean
}

/** Everything a job touches. The Worker binds these to the real objects; tests pass fakes. */
export interface DeletionTargets {
	/** Closes the room's sockets, so nothing new is written while the job runs. */
	closeRoom(roomId: RoomId): Promise<void>
	roomInventory(roomId: RoomId): Promise<{ agents: string[]; keys: string[] }>
	wipeAgent(roomId: RoomId, slug: string): Promise<number>
	wipeRoom(roomId: RoomId): Promise<number>
	/** Returns the rooms that remain. */
	roomDeleted(roomId: RoomId): Promise<number>
	wipeUser(): Promise<number>
	/** Deletes every R2 object under `prefix` and the given keys. Returns how many existed. */
	deleteObjects(prefix: string, keys: string[]): Promise<number>
	deleteAuthRows(): Promise<number>
}

export const userPrefix = (userId: string) => `u/${userId}/`
export const roomPrefix = (userId: string, roomId: string) => `${userPrefix(userId)}r/${roomId}/`

export async function runDeleteJob(job: DeleteAccountJob, t: DeletionTargets): Promise<DeleteReport> {
	const report: DeleteReport = { agents: 0, rooms: 0, user: 0, objects: 0, authRows: 0, finished: false }
	if (job.roomId) {
		const roomId = job.roomId
		await t.closeRoom(roomId)
		const { agents, keys } = await t.roomInventory(roomId)
		report.objects += await t.deleteObjects(roomPrefix(job.userId, roomId), keys)
		for (const slug of agents) if ((await t.wipeAgent(roomId, slug)) > 0) report.agents++
		// The room goes after its files and agents, because it holds the list of them.
		if ((await t.wipeRoom(roomId)) > 0) report.rooms++
		if ((await t.roomDeleted(roomId)) > 0) return report
	}
	if ((await t.wipeUser()) > 0) report.user++
	report.objects += await t.deleteObjects(userPrefix(job.userId), [])
	report.authRows = await t.deleteAuthRows()
	report.finished = true
	return report
}

/** R2 deletes up to 1000 keys in one call. */
const R2_DELETE_BATCH = 1000

async function deleteObjects(bucket: R2Bucket, prefix: string, keys: string[]): Promise<number> {
	const found = new Set<string>()
	let cursor: string | undefined
	do {
		const page = await bucket.list({ prefix, cursor })
		for (const o of page.objects) found.add(o.key)
		cursor = page.truncated ? page.cursor : undefined
	} while (cursor)
	// An indexed key outside the prefix is not this user's object. Only the prefix is trusted.
	const all = [...found, ...keys.filter((k) => k.startsWith(prefix) && !found.has(k))]
	for (let i = 0; i < all.length; i += R2_DELETE_BATCH) await bucket.delete(all.slice(i, i + R2_DELETE_BATCH))
	return found.size
}

async function deleteAuthRows(db: D1Database, userId: string): Promise<number> {
	const results = await db.batch([
		// A deleted user's webhook urls stop resolving (architecture section 25.4).
		db.prepare(`DELETE FROM "hooks" WHERE "user_id" = ?`).bind(userId),
		db.prepare(`DELETE FROM "session" WHERE "userId" = ?`).bind(userId),
		db.prepare(`DELETE FROM "account" WHERE "userId" = ?`).bind(userId),
		db.prepare(`DELETE FROM "user" WHERE "id" = ?`).bind(userId),
	])
	return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
}

/** Binds a job's targets to the user's own objects. Names come only from names.ts. */
export function deletionTargets(env: Env, userId: string): DeletionTargets {
	const user = () => userStub(env.USER, userId)
	return {
		closeRoom: (roomId) => roomStub(env.ROOM, userId, roomId).close(),
		roomInventory: (roomId) => roomStub(env.ROOM, userId, roomId).inventory(),
		wipeAgent: (roomId, slug) => agentStub(env.AGENT, userId, roomId, slug).deleteAll(),
		wipeRoom: (roomId) => roomStub(env.ROOM, userId, roomId).deleteAll(),
		roomDeleted: (roomId) => user().roomDeleted(roomId),
		wipeUser: () => user().deleteAll(),
		deleteObjects: (prefix, keys) => deleteObjects(env.FILES, prefix, keys),
		deleteAuthRows: () => deleteAuthRows(env.AUTH_DB, userId),
	}
}

/**
 * The queue consumer's entry. Returns false when the message is another job. A failed
 * run retries only this message, after a delay, and the next run picks up where it stopped.
 */
export async function consumeDeleteAccountJob(message: Message, env: Env): Promise<boolean> {
	const job = message.body
	if (!isDeleteAccountJob(job)) return false
	try {
		await runDeleteJob(job, deletionTargets(env, job.userId))
		message.ack()
	} catch {
		// The error is not logged: it can carry an object name with the user id.
		message.retry({ delaySeconds: Math.min(60, 5 * message.attempts) })
	}
	return true
}

/** `sendBatch` takes at most 100 messages (miniflare's `MAX_MESSAGE_BATCH_COUNT`). */
const QUEUE_BATCH = 100

/** Enqueues one job per room, or one finishing job when the user has no rooms. */
export async function enqueueDeletion(queue: Queue, userId: string, rooms: RoomId[]): Promise<void> {
	const jobs: DeleteAccountJob[] = rooms.length
		? rooms.map((roomId) => ({ kind: "delete-account", userId, roomId }))
		: [{ kind: "delete-account", userId, roomId: null }]
	for (let i = 0; i < jobs.length; i += QUEUE_BATCH) {
		await queue.sendBatch(jobs.slice(i, i + QUEUE_BATCH).map((body) => ({ body })))
	}
}
