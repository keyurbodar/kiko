import { afterEach, describe, expect, test } from "bun:test"
import { fetchStorage, formatSize, nearlyFull, readStorage, WARN_BYTES } from "./storage-client"

describe("storage", () => {
	test("an answer is kept only when it is the contract", () => {
		expect(readStorage({ objectBytes: 5, archiveEnabled: false })).toEqual({ objectBytes: 5, archiveEnabled: false })
		for (const bad of [null, {}, { objectBytes: "5", archiveEnabled: true }, { objectBytes: -1, archiveEnabled: true }, { objectBytes: Number.NaN, archiveEnabled: true }, { objectBytes: 5 }, { objectBytes: 5, archiveEnabled: "yes" }])
			expect(readStorage(bad)).toBeNull()
	})

	test("the warning needs 800 MB used and no R2", () => {
		expect(nearlyFull({ objectBytes: WARN_BYTES - 1, archiveEnabled: false })).toBe(false)
		expect(nearlyFull({ objectBytes: WARN_BYTES, archiveEnabled: false })).toBe(true)
		expect(nearlyFull({ objectBytes: 2 * WARN_BYTES, archiveEnabled: true })).toBe(false)
	})

	test("sizes are decimal, so the warning's 800 MB reads as 800 MB", () => {
		expect(formatSize(0)).toBe("0 B")
		expect(formatSize(999)).toBe("999 B")
		expect(formatSize(12_345)).toBe("12.3 KB")
		expect(formatSize(WARN_BYTES)).toBe("800 MB")
		expect(formatSize(1_000_000_000)).toBe("1.0 GB")
		expect(formatSize(1_240_000_000)).toBe("1.2 GB")
	})

	describe("fetch", () => {
		const real = globalThis.fetch
		afterEach(() => void (globalThis.fetch = real))
		const answer = (status: number, body: unknown) => (globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch)

		test("a good answer is returned, and a refusal or a wrong shape throws", async () => {
			answer(200, { objectBytes: 7, archiveEnabled: true })
			expect(await fetchStorage()).toEqual({ objectBytes: 7, archiveEnabled: true })
			answer(500, { error: "x" })
			await expect(fetchStorage()).rejects.toThrow()
			answer(200, { objectBytes: "7" })
			await expect(fetchStorage()).rejects.toThrow()
		})
	})
})
