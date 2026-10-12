import { expect, test } from "bun:test"
import { isWiped, storedRows, wipeStorage } from "@yuki/durable/wipe"

// A stand-in for a Durable Object's storage: key-value entries only, which is all the wipe touches here.
function object() {
	const kv = new Map<string, unknown>()
	const storage = {
		get: async (key: string) => kv.get(key),
		put: async (key: string, value: unknown) => {
			kv.set(key, value)
		},
		list: async () => new Map(kv),
		deleteAll: async () => kv.clear(),
		deleteAlarm: async () => {},
		sql: { exec: () => ({ toArray: () => [], one: () => ({ n: 0 }) }) },
	}
	const ctx = { storage, getWebSockets: () => [] }
	return { kv, storage: storage as unknown as DurableObjectStorage, ctx: ctx as unknown as DurableObjectState }
}

test("an object reads as wiped while its shutdown runs, so an alarm or receive does no work then", async () => {
	const { kv, storage, ctx } = object()
	kv.set("row", 1)
	let seenWhileShuttingDown: boolean | undefined
	await wipeStorage(ctx, async () => {
		seenWhileShuttingDown = await isWiped(storage)
	})
	expect(seenWhileShuttingDown).toBe(true)
	expect([...kv.keys()]).toEqual(["wiped"])
})

test("a deletion whose shutdown fails stays refused, and a retry finishes the wipe", async () => {
	const { kv, storage, ctx } = object()
	kv.set("row", 1)
	let calls = 0
	const shutdown = async () => {
		if (calls++ === 0) throw new Error("shutdown failed")
	}
	await expect(wipeStorage(ctx, shutdown)).rejects.toThrow("shutdown failed")
	expect(await isWiped(storage)).toBe(true)
	await wipeStorage(ctx, shutdown)
	expect([...kv.keys()]).toEqual(["wiped"])
})

test("a finished wipe runs no shutdown again, so a probe of a wiped object touches no tables", async () => {
	const { kv, ctx } = object()
	kv.set("row", 1)
	await wipeStorage(ctx)
	let shutdowns = 0
	expect(await wipeStorage(ctx, async () => void shutdowns++)).toBe(0)
	expect(shutdowns).toBe(0)
	expect([...kv.keys()]).toEqual(["wiped"])
})

test("a probe during deletion counts the rows still there, so a second deletion does not start on an empty count", async () => {
	const { kv, storage, ctx } = object()
	kv.set("row", 1)
	let during: number | undefined
	await wipeStorage(ctx, async () => {
		during = await storedRows(storage)
	})
	expect(during).toBe(1)
	expect([...kv.keys()]).toEqual(["wiped"])
})

test("a probe after a finished wipe counts the rows written since, and the marker is never a row", async () => {
	const { kv, storage, ctx } = object()
	await wipeStorage(ctx)
	expect(await storedRows(storage)).toBe(0)
	kv.set("late", 1)
	kv.set("later", 2)
	expect(await storedRows(storage)).toBe(2)
})
