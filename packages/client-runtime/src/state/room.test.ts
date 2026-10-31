import type { Message, MessageId, RoomSnapshot } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import { roomReducer } from "./room"

const message = (seq: number, text = `m${seq}`, id = `${seq}.room`): Message => ({
  id: id as MessageId,
  seq,
  at: seq,
  from: { kind: "agent", slug: "kiko" as never },
  text,
})

const room = (messages: ReadonlyArray<Message>): RoomSnapshot => ({
  seq: 0,
  readSeq: 0,
  members: [],
  messages: [...messages],
  tasks: [],
  files: [],
  folders: [],
})

const put = (messages: ReadonlyArray<Message>, incoming: Message): readonly Message[] =>
  roomReducer.applyEvent(room(messages), { t: "message", ...incoming }, 0).messages

describe("room message ordering", () => {
  it("appends a newer message after the tail", () => {
    expect(put([message(1), message(2)], message(3)).map((m) => m.id)).toEqual(["1.room", "2.room", "3.room"])
  })

  it("replaces the tail message when a newer copy of it arrives", () => {
    expect(put([message(1), message(2)], message(4, "grown", "2.room"))).toEqual([
      message(1),
      message(4, "grown", "2.room"),
    ])
  })

  it("inserts an out-of-order message by sequence", () => {
    expect(put([message(1), message(3)], message(2)).map((m) => m.seq)).toEqual([1, 2, 3])
  })

  it("replaces a duplicate that is not at the tail", () => {
    expect(put([message(1), message(2), message(3)], message(1, "edited"))).toEqual([
      message(1, "edited"),
      message(2),
      message(3),
    ])
  })

  it("appends a message that ties the tail's sequence", () => {
    expect(put([message(1)], message(1, "tie", "other.room")).map((m) => m.id)).toEqual(["1.room", "other.room"])
  })

  it("appends into an empty room", () => {
    expect(put([], message(1))).toEqual([message(1)])
  })
})
