import { describe, expect, it } from "@effect/vitest"
import { plain, plainTail } from "./text"

describe("plain", () => {
  it("removes colour and cursor codes", () => {
    expect(plain("\x1b[31mred\x1b[0m \x1b[2Ktext")).toBe("red text")
  })

  it("removes operating system commands", () => {
    expect(plain("\x1b]0;title\x07after")).toBe("after")
    expect(plain("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")).toBe("link")
  })

  it("normalises line endings and drops control characters", () => {
    expect(plain("one\r\ntwo\rthree\x07")).toBe("one\ntwo\nthree")
  })

  it("keeps the end of a long output", () => {
    const out = plainTail(`${"x".repeat(20_000)}tail`)

    expect(out.length).toBe(16_384)
    expect(out.endsWith("tail")).toBe(true)
  })
})
