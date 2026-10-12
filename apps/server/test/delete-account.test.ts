import { describe, expect, test } from "bun:test"
import type { RoomId } from "@yuki/protocol"
import { FRESH_SESSION_MS, isFresh, rollbackDeletion } from "../src/auth/account-route"
import { type DeleteAccountJob, type DeletionTargets, isDeleteAccountJob, roomPrefix, runDeleteJob, startDeletion, userPrefix } from "../src/jobs/delete-account"

const USER = "u1"
const GEN = 7
const ROOM_A = "01JAAAAAAAAAAAAAAAAAAAAAAA" as RoomId
const ROOM_B = "01JBBBBBBBBBBBBBBBBBBBBBBB" as RoomId

type Step = keyof DeletionTargets

function account() {
	const state = {
		rooms: new Map<RoomId, { agents: string[]; keys: string[]; rows: number }>([
			[ROOM_A, { agents: ["ada", "bob"], keys: [`${roomPrefix(USER, ROOM_A)}f1`], rows: 5 }],
			[ROOM_B, { agents: [], keys: [`${roomPrefix(USER, ROOM_B)}f2`], rows: 3 }],
		]),
		agents: new Map([[`${ROOM_A}:ada`, 2], [`${ROOM_A}:bob`, 1]]),
		ledger: new Set<RoomId>([ROOM_A, ROOM_B]),
		userRows: 4,
		objects: new Set([`${roomPrefix(USER, ROOM_A)}f1`, `${roomPrefix(USER, ROOM_B)}f2`, `${userPrefix(USER)}stray`]),
		authRows: 3,
		deletion: GEN as number | null,
		wiped: false,
	}
	const failOnce = new Set<Step>()
	const calls: Step[] = []
	const step = <T>(name: Step, fn: () => T): Promise<T> => {
		calls.push(name)
		if (failOnce.delete(name)) return Promise.reject(new Error(`${name} failed`))
		return Promise.resolve(fn())
	}
	const targets: DeletionTargets = {
		closeRoom: () => step("closeRoom", () => undefined),
		roomInventory: (id) => step("roomInventory", () => {
			const r = state.rooms.get(id)
			return { agents: r?.agents ?? [], keys: r?.keys ?? [] }
		}),
		wipeAgent: (id, slug) => step("wipeAgent", () => {
			const rows = state.agents.get(`${id}:${slug}`) ?? 0
			state.agents.delete(`${id}:${slug}`)
			return rows
		}),
		wipeRoom: (id) => step("wipeRoom", () => {
			const rows = state.rooms.get(id)?.rows ?? 0
			state.rooms.delete(id)
			return rows
		}),
		roomDeleted: (id) => step("roomDeleted", () => {
			state.ledger.delete(id)
			return state.ledger.size
		}),
		wipeUser: () => step("wipeUser", () => {
			const rows = state.userRows
			state.userRows = 0
			state.ledger.clear()
			state.wiped = true
			return rows
		}),
		deleteObjects: (prefix) => step("deleteObjects", () => {
			const hit = [...state.objects].filter((k) => k.startsWith(prefix))
			for (const k of hit) state.objects.delete(k)
			return hit.length
		}),
		deleteAuthRows: () => step("deleteAuthRows", () => {
			const rows = state.authRows
			state.authRows = 0
			return rows
		}),
		deletionCurrent: async (generation) => state.wiped || state.deletion === generation,
	}
	const empty = () =>
		state.rooms.size === 0 && state.agents.size === 0 && state.userRows === 0 && state.objects.size === 0 && state.authRows === 0
	return { state, targets, failOnce, calls, empty }
}

const job = (roomId: RoomId | null, generation = GEN): DeleteAccountJob => ({ kind: "delete-account", userId: USER, roomId, generation })

describe("runDeleteJob", () => {
	test("the last room job finishes the account, and the auth rows go last", async () => {
		const a = account()
		const first = await runDeleteJob(job(ROOM_A), a.targets)
		expect(first).toEqual({ agents: 2, rooms: 1, user: 0, objects: 1, authRows: 0, finished: false })
		expect(a.state.userRows).toBe(4)
		const last = await runDeleteJob(job(ROOM_B), a.targets)
		expect(last).toEqual({ agents: 0, rooms: 1, user: 1, objects: 2, authRows: 3, finished: true })
		expect(a.empty()).toBe(true)
		expect(a.calls.at(-1)).toBe("deleteAuthRows")
		expect(a.calls.indexOf("wipeUser")).toBeLessThan(a.calls.indexOf("deleteAuthRows"))
	})

	test("an account with no rooms is finished by one job", async () => {
		const a = account()
		a.state.rooms.clear()
		a.state.agents.clear()
		a.state.ledger.clear()
		const report = await runDeleteJob(job(null), a.targets)
		expect(report.finished).toBe(true)
		expect(a.state.userRows).toBe(0)
		expect(a.state.authRows).toBe(0)
	})

	for (const failing of ["deleteObjects", "wipeAgent", "wipeRoom", "roomDeleted", "wipeUser", "deleteAuthRows"] as Step[]) {
		test(`a job that fails at ${failing} completes on retry`, async () => {
			const a = account()
			await runDeleteJob(job(ROOM_B), a.targets)
			a.failOnce.add(failing)
			await expect(runDeleteJob(job(ROOM_A), a.targets)).rejects.toThrow(`${failing} failed`)
			expect(a.empty()).toBe(false)
			const retry = await runDeleteJob(job(ROOM_A), a.targets)
			expect(retry.finished).toBe(true)
			expect(a.empty()).toBe(true)
		})
	}

	test("a second run of a finished job deletes nothing", async () => {
		const a = account()
		await runDeleteJob(job(ROOM_A), a.targets)
		await runDeleteJob(job(ROOM_B), a.targets)
		const again = await runDeleteJob(job(ROOM_B), a.targets)
		expect(again).toEqual({ agents: 0, rooms: 0, user: 0, objects: 0, authRows: 0, finished: true })
	})
})

test("isDeleteAccountJob accepts only well formed jobs", () => {
	expect(isDeleteAccountJob(job(ROOM_A))).toBe(true)
	expect(isDeleteAccountJob(job(null))).toBe(true)
	expect(isDeleteAccountJob({ kind: "delete-account", userId: USER, roomId: "nope" })).toBe(false)
	expect(isDeleteAccountJob({ kind: "image", userId: USER, roomId: null })).toBe(false)
	expect(isDeleteAccountJob({ kind: "delete-account", userId: USER, roomId: null })).toBe(false)
	expect(isDeleteAccountJob(null)).toBe(false)
})

test("a recent sign-in is one younger than the fresh window", () => {
	const now = 1_000_000_000_000
	expect(isFresh(now - 1000, now)).toBe(true)
	expect(isFresh(now - FRESH_SESSION_MS, now)).toBe(false)
	expect(isFresh(new Date(now - FRESH_SESSION_MS + 1).toISOString(), now)).toBe(true)
	expect(isFresh("not a date", now)).toBe(false)
})

describe("startDeletion", () => {
	function signup(rooms: RoomId[]) {
		const state = { tombstoned: false, deleting: false, queued: [] as RoomId[], failSends: 0 }
		return {
			state,
			start: () =>
				startDeletion({
					revoke: async () => void (state.tombstoned = true),
					begin: async () => {
						state.deleting = true
						return { generation: GEN, rooms }
					},
					enqueue: async ({ rooms: ids }) => {
						if (state.failSends-- > 0) {
							state.queued.push(...ids.slice(0, 1))
							throw new Error("queue unavailable")
						}
						state.queued.push(...ids)
					},
					abort: async () => {
						state.deleting = false
						state.tombstoned = false
					},
				}),
		}
	}

	test("a failed queue send leaves no tombstone, and the retry queues every room", async () => {
		const a = signup([ROOM_A, ROOM_B])
		a.state.failSends = 1
		await expect(a.start()).rejects.toThrow("queue unavailable")
		expect(a.state.tombstoned).toBe(false)
		expect(a.state.deleting).toBe(false)
		expect(await a.start()).toBe(2)
		expect(a.state.tombstoned).toBe(true)
		expect(new Set(a.state.queued)).toEqual(new Set([ROOM_A, ROOM_B]))
	})

	test("a job that a failed start queued does nothing after the rollback", async () => {
		const a = account()
		const queued: DeleteAccountJob[] = []
		await expect(
			startDeletion({
				revoke: async () => {},
				begin: async () => {
					a.state.deletion = GEN
					return { generation: GEN, rooms: [ROOM_A, ROOM_B] }
				},
				enqueue: async () => {
					queued.push(job(ROOM_A))
					throw new Error("queue unavailable")
				},
				abort: async () => {
					a.state.deletion = null
				},
			}),
		).rejects.toThrow("queue unavailable")
		expect(queued).toHaveLength(1)
		const report = await runDeleteJob(queued[0]!, a.targets)
		expect(report).toEqual({ agents: 0, rooms: 0, user: 0, objects: 0, authRows: 0, finished: false })
		expect(a.calls).toEqual([])
		expect(a.state.rooms.has(ROOM_A)).toBe(true)
	})

	test("a failed rollback still reports the original error", async () => {
		await expect(
			startDeletion({
				revoke: async () => {},
				begin: async () => ({ generation: GEN, rooms: [] }),
				enqueue: async () => {
					throw new Error("queue unavailable")
				},
				abort: async () => {
					throw new Error("d1 down")
				},
			}),
		).rejects.toThrow("queue unavailable")
	})
})

describe("rollbackDeletion", () => {
	test("a cancel that throws still lets the user sign in, and a retry can cancel again", async () => {
		const deleted = new Set([USER])
		const db = { prepare: () => ({ bind: () => ({ run: async () => void deleted.delete(USER) }) }) } as unknown as D1Database
		let cancels = 0
		const user = {
			cancelDeletion: async () => {
				if (cancels++ === 0) throw new Error("object unavailable")
			},
		}
		await expect(rollbackDeletion(db, user, USER)).rejects.toThrow("object unavailable")
		expect(deleted.has(USER)).toBe(false)
		await rollbackDeletion(db, user, USER)
		expect(cancels).toBe(2)
	})
})
