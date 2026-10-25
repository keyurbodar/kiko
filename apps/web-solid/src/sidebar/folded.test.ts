import { describe, expect, it } from "vitest"
import { parseFolded, serializeFolded } from "./folded"

describe("folded sections", () => {
  it("reads back what was saved", () => {
    expect(parseFolded(serializeFolded({ working: true, chats: false }))).toEqual({ working: true, chats: false })
  })

  it("starts everything open when nothing is saved or the value is damaged", () => {
    expect(parseFolded(null)).toEqual({})
    expect(parseFolded("not json")).toEqual({})
    expect(parseFolded('{"chats":"yes","needs":true}')).toEqual({ needs: true })
  })
})
