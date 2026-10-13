import { expect, test } from "bun:test"
import { MAX_MESSAGE_TEXT } from "@kiko/protocol"
import { bubbleOf, discardWhole, fileIdOf, MAX_BUBBLE_BYTES, putWhole, WHOLE_TYPE } from "../src/room/whole-text"

const jsonBytes = (s: string) => new TextEncoder().encode(JSON.stringify(s)).length

test("a short text is its own bubble", () => {
  expect(bubbleOf("hello there")).toBe("hello there")
})

test("a bubble is at most the message text limit in characters", () => {
  expect(bubbleOf("a".repeat(20_000))).toBe("a".repeat(MAX_MESSAGE_TEXT))
})

test("a bubble is at most the bubble's JSON bytes, so control characters cannot overflow an inbox entry", () => {
  const bubble = bubbleOf("\u001b".repeat(16_000))
  expect(jsonBytes(bubble)).toBeLessThanOrEqual(MAX_BUBBLE_BYTES)
  expect(jsonBytes(bubble) + 6).toBeGreaterThan(MAX_BUBBLE_BYTES)
  expect(bubble.length).toBe(Math.floor(MAX_BUBBLE_BYTES / 6))
})

test("a bubble never splits a surrogate pair", () => {
  const bubble = bubbleOf(`${"a".repeat(MAX_MESSAGE_TEXT - 1)}😀 tail`)
  expect(bubble).toBe("a".repeat(MAX_MESSAGE_TEXT - 1))
})

test("a bubble's cap counts UTF-8 bytes of its JSON, so a three-byte character weighs three", () => {
  // 2,000 euro signs weigh 6,000 bytes. The control characters after them fill the rest of the 64 KB: 9,922 of them.
  const bubble = bubbleOf("€".repeat(2_000) + "\u001b".repeat(12_000))
  expect(bubble.length).toBe(2_000 + 9_922)
  expect(new TextEncoder().encode(JSON.stringify(bubble)).length).toBeLessThanOrEqual(MAX_BUBBLE_BYTES + 2)
})

test("a fully emoji text cuts at a whole code point", () => {
  const bubble = bubbleOf("😀".repeat(9_000))
  expect(bubble).not.toMatch(/[\uD800-\uDBFF]$/)
  expect(bubble.length).toBe(MAX_MESSAGE_TEXT)
})

test("a file id is the same for the same client id, and differs between client ids", async () => {
  const id = await fileIdOf("client-1")
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  expect(await fileIdOf("client-1")).toBe(id)
  expect(await fileIdOf("client-2")).not.toBe(id)
})

function fakeBucket() {
  const puts: { key: string; body: Uint8Array; type: string | undefined }[] = []
  const deletes: string[] = []
  const bucket = {
    put: async (key: string, body: Uint8Array, opts: { httpMetadata: { contentType: string } }) => void puts.push({ key, body, type: opts.httpMetadata.contentType }),
    delete: async (keys: string | string[]) => void deletes.push(...(Array.isArray(keys) ? keys : [keys])),
  }
  return { bucket: bucket as unknown as R2Bucket, puts, deletes }
}

test("the whole text is written under the room's key with its size and hash", async () => {
  const { bucket, puts } = fakeBucket()
  const whole = await putWhole(bucket, { userId: "alice", roomId: "room1" }, "client-1", "héllo")
  expect(whole.r2Key).toBe(`u/alice/r/room1/${whole.id}`)
  expect(whole.size).toBe(new TextEncoder().encode("héllo").length)
  expect(whole.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(puts).toHaveLength(1)
  expect(puts[0]?.key).toBe(whole.r2Key)
  expect(new TextDecoder().decode(puts[0]?.body)).toBe("héllo")
  expect(puts[0]?.type).toBe(WHOLE_TYPE)
})

test("a discarded whole text is deleted by its key", async () => {
  const { bucket, deletes } = fakeBucket()
  const whole = await putWhole(bucket, { userId: "alice", roomId: "room1" }, "client-1", "text")
  await discardWhole(bucket, whole)
  expect(deletes).toEqual([whole.r2Key])
})
