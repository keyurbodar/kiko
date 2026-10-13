import "fake-indexeddb/auto"
import { describe, expect, test } from "bun:test"
import type { MessageId } from "@kiko/protocol"
import { IDBFactory } from "fake-indexeddb"
import { openWarm } from "./db"
import { createDraftBook } from "./drafts"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("draft book", () => {
	test("a draft, a reply target, and a scroll position survive a reload", async () => {
		const idb = new IDBFactory()
		const warm = await openWarm({ userId: "u1", idb })
		const book = createDraftBook(warm, 20)
		book.save("A", { text: "half a thou" })
		book.save("A", { replyTo: "m1" as MessageId })
		book.saveScroll("A", { messageId: "m7", offset: 12 })
		expect(book.get("A")?.text).toBe("half a thou")
		await wait(60)
		await book.flush()
		warm.close()

		const again = createDraftBook(await openWarm({ userId: "u1", idb }), 20)
		await wait(30)
		expect(again.ready()).toBe(true)
		expect(again.get("A")).toMatchObject({ text: "half a thou", replyTo: "m1" })
		expect(again.scroll("A")).toEqual({ messageId: "m7", offset: 12 })
		expect(again.has("A")).toBe(true)
		expect(again.has("B")).toBe(false)
	})

	test("typing is debounced and emptying the text removes the draft", async () => {
		const idb = new IDBFactory()
		const warm = await openWarm({ userId: "u1", idb, flushEveryMs: 5 })
		const book = createDraftBook(warm, 40)
		for (const text of ["h", "he", "hel"]) book.save("A", { text })
		expect(await warm.get("drafts", "A")).toBeUndefined()
		await wait(120)
		expect(((await warm.get("drafts", "A")) as { text: string }).text).toBe("hel")
		book.save("A", { text: "" })
		expect(book.has("A")).toBe(false)
		await wait(120)
		expect(await warm.get("drafts", "A")).toBeUndefined()
	})
})
