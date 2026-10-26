import { describe, expect, it } from "vitest"
import { summarize } from "./summary"
import type { PageView } from "./types"

const page = (scroll?: PageView["scroll"]): PageView => ({
  key: "k",
  url: "https://example.com/",
  title: "Example",
  controls: [],
  text: "hello",
  omitted: 0,
  ...(scroll ? { scroll } : {}),
})

describe("summarize", () => {
  it("says how far down a tall page is scrolled and how much is left", () => {
    expect(summarize(page({ y: 0, height: 2400, view: 800 })).split("\n")[2]).toBe("scrolled 0 of 2400px, 1600px below")
    expect(summarize(page({ y: 1600, height: 2400, view: 800 })).split("\n")[2]).toBe(
      "scrolled 1600 of 2400px, 0px below",
    )
  })

  it("says nothing about scrolling when the page fits", () => {
    expect(summarize(page({ y: 0, height: 700, view: 800 }))).toBe("Example\nhttps://example.com/\n\nhello")
    expect(summarize(page())).toBe("Example\nhttps://example.com/\n\nhello")
  })
})
