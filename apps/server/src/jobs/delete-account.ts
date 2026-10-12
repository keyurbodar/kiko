import { isRoomId, type RoomId } from "@yuki/protocol"
import type { Env } from "../index"
import { agentStub, roomStub, userStub } from "../lib/names"

// Every step is safe to run twice: a wiped object or missing row is not an error, so a failed job completes on retry.

// `generation` is the deletion that queued the job. A job whose deletion was rolled back, or superseded by a retry, does nothing.
// `cycles` counts trips through the dead-letter queue, so a deletion that keeps failing is visible in the logs.
export type DeleteAccountJob = { kind: "delete-account"; userId: string; roomId: RoomId | null; generation: number; cycles?: number }

export type Deletion = { generation: number; rooms: RoomId[] }

export function isDeleteAccountJob(body: unknown): body is DeleteAccountJob {
	if (!body || typeof body !== "object") return false
	const b = body as Record<string, unknown>
	return (
		b.kind === "delete-account" &&
		typeof b.userId === "string" &&
		(b.roomId === null || (typeof b.roomId === "string" && isRoomId(b.roomId))) &&
		Number.isSafeInteger(b.generation) &&
		(b.cycles === undefined || Number.isSafeInteger(b.cycles))
	)
}

export type DeleteReport = {
	agents: number
	rooms: number
	user: number
	objects: number
	authRows: number
	finished: boolean
}

export interface DeletionTargets {
	closeRoom(roomId: RoomId): Promise<void>
	roomInventory(roomId: RoomId): Promise<{ agents: string[]; keys: string[] }>
	wipeAgent(roomId: RoomId, slug: string): Promise<number>
	wipeRoom(roomId: RoomId): Promise<number>
	roomDeleted(roomId: RoomId): Promise<number>
	wipeUser(): Promise<number>
	deleteObjects(prefix: string, keys: string[]): Promise<number>
	deleteAuthRows(): Promise<number>
	deletionCurrent(generation: number): Promise<boolean>
}

export const userPrefix = (userId: string) => `u/${userId}/`
export const roomPrefix = (userId: string, roomId: string) => `${userPrefix(userId)}r/${roomId}/`

class Superseded extends Error {}

export async function runDeleteJob(job: DeleteAccountJob, t: DeletionTargets): Promise<DeleteReport> {
	const report: DeleteReport = { agents: 0, rooms: 0, user: 0, objects: 0, authRows: 0, finished: false }
	// Every destructive step re-checks the generation, so a rollback that lands mid-job stops the job before its next step.
	const step = async <T>(run: () => Promise<T>): Promise<T> => {
		if (!(await t.deletionCurrent(job.generation))) throw new Superseded()
		return run()
	}
	try {
		if (job.roomId) {
			const roomId = job.roomId
			await step(() => t.closeRoom(roomId))
			const { agents, keys } = await t.roomInventory(roomId)
			report.objects += await step(() => t.deleteObjects(roomPrefix(job.userId, roomId), keys))
			for (const slug of agents) if ((await step(() => t.wipeAgent(roomId, slug))) > 0) report.agents++
			if ((await step(() => t.wipeRoom(roomId))) > 0) report.rooms++
			if ((await step(() => t.roomDeleted(roomId))) > 0) return report
		}
		if ((await step(() => t.wipeUser())) > 0) report.user++
		report.objects += await step(() => t.deleteObjects(userPrefix(job.userId), []))
		report.authRows = await step(() => t.deleteAuthRows())
		report.finished = true
		return report
	} catch (e) {
		if (e instanceof Superseded) return report
		throw e
	}
}

const R2_DELETE_BATCH = 1000
const QUEUE_BATCH = 100

async function deleteObjects(bucket: R2Bucket, prefix: string, keys: string[]): Promise<number> {
	const found = new Set<string>()
	let cursor: string | undefined
	do {
		const page = await bucket.list({ prefix, cursor })
		for (const o of page.objects) found.add(o.key)
		cursor = page.truncated ? page.cursor : undefined
	} while (cursor)
	const all = [...found, ...keys.filter((k) => k.startsWith(prefix) && !found.has(k))]
	for (let i = 0; i < all.length; i += R2_DELETE_BATCH) await bucket.delete(all.slice(i, i + R2_DELETE_BATCH))
	return found.size
}

async function deleteAuthRows(db: D1Database, userId: string): Promise<number> {
	const results = await db.batch([
		db.prepare(`DELETE FROM "hooks" WHERE "user_id" = ?`).bind(userId),
		db.prepare(`DELETE FROM "session" WHERE "userId" = ?`).bind(userId),
		db.prepare(`DELETE FROM "account" WHERE "userId" = ?`).bind(userId),
		db.prepare(`DELETE FROM "user" WHERE "id" = ?`).bind(userId),
	])
	return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
}

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
		deletionCurrent: (generation) => user().deletionCurrent(generation),
	}
}

export async function enqueueDeletion(queue: Queue, userId: string, { generation, rooms }: Deletion): Promise<void> {
	const jobs: DeleteAccountJob[] = rooms.length
		? rooms.map((roomId) => ({ kind: "delete-account", userId, roomId, generation }))
		: [{ kind: "delete-account", userId, roomId: null, generation }]
	for (let i = 0; i < jobs.length; i += QUEUE_BATCH) {
		await queue.sendBatch(jobs.slice(i, i + QUEUE_BATCH).map((body) => ({ body })))
	}
}

interface DeletionStart {
	revoke(): Promise<void>
	begin(): Promise<Deletion>
	enqueue(deletion: Deletion): Promise<void>
	// Undoes revoke and begin so the user can sign in and ask again.
	abort(): Promise<void>
}

// The tombstone must land before any data is touched, so a failed queue send undoes it: a tombstoned user is answered 401 and could never retry.
// Jobs already queued by a partial send are harmless; they only delete data the user asked to delete, and the retry queues the rest.
export async function startDeletion(s: DeletionStart): Promise<number> {
	await s.revoke()
	try {
		const deletion = await s.begin()
		await s.enqueue(deletion)
		return deletion.rooms.length
	} catch (e) {
		await s.abort().catch((abortError) => console.error("account deletion rollback failed", abortError))
		throw e
	}
}
