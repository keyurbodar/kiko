import { describe, expect, it } from "vitest"
import { dropRoomPreviews, keepPreview, memoryPreview } from "./cache"
import type { Preview } from "./model"

const preview = (text: string): Preview => ({ kind: "lines", lines: [text], mono: false })

describe("the preview memory cache", () => {
  it("keeps only the newest previews", () => {
    for (let i = 0; i < 500; i += 1) keepPreview("room-a", `bounded-${i}`, preview(`${i}`))
    expect(memoryPreview("bounded-0")).toBeUndefined()
    expect(memoryPreview("bounded-499")).toEqual(preview("499"))
  })

  it("forgets a removed room's previews", () => {
    keepPreview("gone", "gone-1", preview("a"))
    keepPreview("kept", "kept-1", preview("b"))
    dropRoomPreviews("gone")
    expect(memoryPreview("gone-1")).toBeUndefined()
    expect(memoryPreview("kept-1")).toEqual(preview("b"))
  })
})
