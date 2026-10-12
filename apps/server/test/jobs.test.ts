import { expect, test } from "bun:test"
import { consume, DEAD_LETTER_QUEUE, retryDelay } from "../src/jobs/consumer"

const deletion = { kind: "delete-account", userId: "u1", roomId: null, generation: 1 } as const

function fakeEnv(failures = 0) {
	const seen = { wipes: 0, sent: [] as unknown[] }
	const user = {
		deletionCurrent: async () => true,
		deleteAll: async () => {
			seen.wipes++
			if (seen.wipes <= failures) throw new Error("the object is busy")
			return 1
		},
	}
	const env = {
		USER: { idFromName: (n: string) => n, get: () => user },
		FILES: { list: async () => ({ objects: [], truncated: false }), delete: async () => {} },
		AUTH_DB: { prepare: () => ({ bind: () => ({}) }), batch: async () => [] },
		JOBS: { send: async (body: unknown) => void seen.sent.push(body) },
	}
	return { env: env as never, seen }
}

function batch(body: unknown, attempts: number, queue = "kiko-jobs") {
	const seen = { ack: 0, retry: [] as unknown[] }
	const message = { body, attempts, ack: () => seen.ack++, retry: (o: unknown) => seen.retry.push(o) }
	return { b: { queue, messages: [message] } as never, seen }
}

test("a job that throws is retried with a growing delay, then succeeds on the third delivery", async () => {
	const t = fakeEnv(2)
	const first = batch(deletion, 1)
	await consume(first.b, t.env)
	const second = batch(deletion, 2)
	await consume(second.b, t.env)
	const third = batch(deletion, 3)
	await consume(third.b, t.env)
	expect([first.seen.retry, second.seen.retry]).toEqual([[{ delaySeconds: 1 }], [{ delaySeconds: 2 }]])
	expect([first.seen.ack, second.seen.ack, third.seen.ack]).toEqual([0, 0, 1])
	expect(t.seen.wipes).toBe(3)
})

test("a dead account deletion goes back to the main queue, and other dead bodies are dropped", async () => {
	const t = fakeEnv()
	const d = batch(deletion, 1, DEAD_LETTER_QUEUE)
	await consume(d.b, t.env)
	const other = batch({ type: "attachment", userId: "u1", roomId: "r", fileId: "f" }, 1, DEAD_LETTER_QUEUE)
	await consume(other.b, t.env)
	expect(t.seen.sent).toEqual([deletion])
	expect([d.seen.ack, other.seen.ack]).toEqual([1, 1])
})

test("an unknown job is dropped, not retried forever", async () => {
	const t = fakeEnv()
	const old = batch({ type: "attachment", userId: "u1", roomId: "01JZ8Q4T6M0000000000000001", fileId: "f1" }, 1)
	await consume(old.b, t.env)
	expect(old.seen).toEqual({ ack: 1, retry: [] })
	expect(t.seen.wipes).toBe(0)
	expect(retryDelay(20)).toBe(60)
})
