import { describe, expect, it } from "@effect/vitest"
import { plain, plainTail, replay } from "./text"

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

describe("replay", () => {
  it("keeps colour and modes so the replay looks like the shell", () => {
    expect(replay("\x1b[31mred\x1b[0m\x1b[?2004h", 100)).toBe("\x1b[31mred\x1b[0m\x1b[?2004h")
  })

  it("drops queries that a renderer would answer into the shell", () => {
    expect(replay("a\x1b[6nb\x1b[?1;2cc\x1b[>0qd\x1b[?u", 100)).toBe("abcd")
  })

  it("keeps setter sequences that look like queries", () => {
    expect(replay("\x1b[?25h\x1b[2 q\x1b[?1049h", 100)).toBe("\x1b[?25h\x1b[2 q\x1b[?1049h")
  })

  it("drops terminal attribute queries from operating system commands", () => {
    expect(replay("\x1b]10;?\x07keep\x1b]0;title\x07", 100)).toBe("keep\x1b]0;title\x07")
  })

  it("keeps the tail and starts on a whole line", () => {
    const out = replay(`old line\n${"x".repeat(50)}\nnew line`, 20)

    expect(out).toBe("new line")
  })
})
