import { assert, describe, it } from "@effect/vitest"
import { ModelError } from "@kiko/protocol"
import { streamFrame, type Subscription } from "./streams"

const roomSub = (cursor: number): Subscription => ({ requestId: "4", stream: "room:r", cursor })
const userSub = (cursor: number): Subscription => ({ requestId: "5", stream: "user", cursor })

const values = (text: string | null) => (text === null ? null : (JSON.parse(text) as { values: unknown[] }).values)

const at = 1_767_225_600_000
const read = (seq: number) => ({ t: "read", seq, at, upTo: seq })

describe("stream frames", () => {
  it("keeps a room error signal that the room broadcast as json", () => {
    const raw = JSON.stringify({ t: "error", error: new ModelError({ message: "No key", action: "open_models" }) })
    const out = streamFrame(roomSub(0), raw)
    assert.deepStrictEqual(values(out.text), [
      {
        kind: "signal",
        signal: { t: "error", error: { _tag: "ModelError", message: "No key", action: "open_models" } },
      },
    ])
  })

  it("drops room events at or below the cursor and advances it", () => {
    const raw = JSON.stringify({ t: "events", events: [read(3), read(4), read(5)] })
    const out = streamFrame(roomSub(4), raw)
    assert.strictEqual(out.cursor, 5)
    assert.deepStrictEqual(
      (values(out.text) as { sequence: number }[]).map((item) => item.sequence),
      [5],
    )
  })

  it("starts the cursor at the snapshot sequence", () => {
    const out = streamFrame(userSub(0), JSON.stringify({ t: "events", events: [], version: "1.0.0" }))
    assert.deepStrictEqual(values(out.text), [{ kind: "session", version: "1.0.0" }])
    assert.strictEqual(out.cursor, 0)
  })

  it("drops a frame that does not match the contract instead of throwing", () => {
    const out = streamFrame(roomSub(2), JSON.stringify({ t: "events", events: [{ t: "nonsense" }] }))
    assert.deepStrictEqual(out, { text: null, cursor: 2 })
  })
})
