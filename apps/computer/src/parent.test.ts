import { describe, expect, it } from "@effect/vitest"
import { once } from "node:events"
import { PassThrough } from "node:stream"
import { exitWhenParentDies, parentPipeAsked } from "./parent"

describe("parent lifeline", () => {
  it("exits when the app closes the pipe", async () => {
    const stream = new PassThrough()
    let exits = 0
    exitWhenParentDies(stream, () => {
      exits += 1
    })
    const ended = once(stream, "end")
    stream.end()
    await ended
    expect(exits).toBe(1)
  })

  it("exits once when the pipe ends and then closes", () => {
    const stream = new PassThrough()
    let exits = 0
    exitWhenParentDies(stream, () => {
      exits += 1
    })
    stream.emit("end")
    stream.emit("close")
    expect(exits).toBe(1)
  })

  it("only watches when the app asked for it", () => {
    expect(parentPipeAsked({ KIKO_PARENT_PIPE: "1" })).toBe(true)
    expect(parentPipeAsked({})).toBe(false)
    expect(parentPipeAsked({ KIKO_PARENT_PIPE: "0" })).toBe(false)
  })
})
