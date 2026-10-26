import { describe, expect, it } from "vitest"
import { createSplitter } from "./split-bubbles"

const said = (text: string) => {
  const s = createSplitter()
  return [...s.push(text).blocks, ...s.end().blocks]
}

describe("skip", () => {
  it("posts nothing for a reply that is only [skip]", () => {
    expect(said("[skip]")).toEqual([])
  })

  it("never shows a [skip] that follows other words", () => {
    expect(said("Both openings are in.\n\n[skip]")).toEqual(["Both openings are in."])
  })
})
