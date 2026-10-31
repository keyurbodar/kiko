import { describe, expect, it } from "@effect/vitest"
import { BoundedHistory } from "./history"

describe("BoundedHistory", () => {
  it("keeps only the last lines", () => {
    const history = new BoundedHistory(3)
    history.append("1\n2\n3\n4\n")

    expect(history.value()).toBe("2\n3\n4\n")
  })

  it("counts a final line without a newline", () => {
    const history = new BoundedHistory(2)
    history.append("1\n2\n3")

    expect(history.value()).toBe("2\n3")
  })

  it("drops the oldest bytes", () => {
    const history = new BoundedHistory(1_000, 5)
    history.append("a😀b")

    expect(history.value()).toBe("😀b")
  })

  it("never splits a code point when evicting bytes", () => {
    const history = new BoundedHistory(1_000, 4)
    history.append("😀😀")

    expect(history.value()).toBe("😀")
  })

  it("joins a surrogate pair split across appends", () => {
    const history = new BoundedHistory()
    history.append("\ud83d")
    history.append("\ude00")

    expect(history.value()).toBe("😀")
  })

  it("reports a truncated tail", () => {
    const history = new BoundedHistory()
    history.append("one\ntwo\nthree\n")

    expect(history.lines(2)).toEqual({ text: "two\nthree\n", truncated: true })
    expect(history.lines(10)).toEqual({ text: "one\ntwo\nthree\n", truncated: false })
  })

  it("clears everything", () => {
    const history = new BoundedHistory()
    history.append("text\n")
    history.clear()

    expect(history.value()).toBe("")
    expect(history.lines(5)).toEqual({ text: "", truncated: false })
  })
})
