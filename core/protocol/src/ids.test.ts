import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Schema } from "effect"
import { isRoomId, messageIdAt, messageSeq, newRoomId } from "./ids"
import { ClientToRoom, RoomId } from "./schema"

const ROOM = newRoomId(1_767_225_600_000, new Uint8Array(16).fill(7))
const OTHER_ROOM = newRoomId(1_767_225_600_000, new Uint8Array(16).fill(9))

describe("message ids", () => {
  it("round-trips the sequence number through the id", () => {
    for (const seq of [1, 2, 41, Number.MAX_SAFE_INTEGER]) {
      assert.strictEqual(messageSeq(ROOM, messageIdAt(ROOM, seq)), seq)
    }
  })

  it("rejects an id minted for another room", () => {
    assert.strictEqual(messageSeq(OTHER_ROOM, messageIdAt(ROOM, 3)), -1)
  })

  it("rejects ids that are not a positive safe sequence", () => {
    const suffix = messageIdAt(ROOM, 1).slice(2)
    for (const id of [`0.${suffix}`, `-1.${suffix}`, `1.5.${suffix}`, `x.${suffix}`, suffix, ""]) {
      assert.strictEqual(messageSeq(ROOM, id), -1, id)
    }
  })
})

describe("room ids", () => {
  it("orders rooms by creation time", () => {
    const earlier = newRoomId(1_767_225_600_000, new Uint8Array(16).fill(255))
    const later = newRoomId(1_767_225_600_001, new Uint8Array(16).fill(0))
    assert.isTrue(isRoomId(earlier))
    assert.isTrue(isRoomId(later))
    assert.isTrue(earlier < later)
  })

  it.effect("decodes a send frame only for a valid room id", () =>
    Effect.gen(function* () {
      const frame = { t: "send", clientId: "c1", text: "hello" } as const
      const decoded = yield* Schema.decodeUnknownEffect(ClientToRoom)(frame)
      assert.deepStrictEqual(decoded, frame)
      assert.strictEqual(yield* Schema.decodeUnknownEffect(RoomId)(ROOM), ROOM)
      const bad = yield* Effect.exit(Schema.decodeUnknownEffect(RoomId)("not-a-room"))
      assert.isTrue(Exit.isFailure(bad))
    }),
  )
})
