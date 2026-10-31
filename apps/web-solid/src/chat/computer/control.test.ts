import type { ComputerInput } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { createInputGate } from "./control"

const text = (s: string): ComputerInput => ({ k: "text", s })
const key = (code: string, down: boolean): ComputerInput => ({ k: "key", code, key: code, down, mods: 0 })

describe("input gate", () => {
  it("holds every event typed before the daemon acks control, then sends them in order", () => {
    const sent: ComputerInput[] = []
    const gate = createInputGate((events) => sent.push(...events))

    gate.hold()
    gate.send([key("KeyA", true)])
    gate.send([text("b")])
    gate.send([key("KeyA", false), text("c")])
    expect(sent).toEqual([])

    gate.release()
    expect(sent).toEqual([key("KeyA", true), text("b"), key("KeyA", false), text("c")])
  })

  it("sends straight through once control is held", () => {
    const sent: ComputerInput[] = []
    const gate = createInputGate((events) => sent.push(...events))

    gate.send([text("a")])

    expect(sent).toEqual([text("a")])
  })

  it("drops what was typed in a gap that never became control", () => {
    const sent: ComputerInput[] = []
    const gate = createInputGate((events) => sent.push(...events))

    gate.hold()
    gate.send([text("lost")])
    gate.discard()
    gate.release()

    expect(sent).toEqual([])
  })
})
