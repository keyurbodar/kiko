import { describe, expect, it } from "@effect/vitest"
import { keyBytes } from "./keys"

describe("keyBytes", () => {
  it("presses named keys", () => {
    expect(keyBytes("enter")).toBe("\r")
    expect(keyBytes("tab")).toBe("\t")
    expect(keyBytes("esc")).toBe("\x1b")
    expect(keyBytes("up")).toBe("\x1b[A")
    expect(keyBytes("backspace")).toBe("\x7f")
    expect(keyBytes("delete")).toBe("\x1b[3~")
  })

  it("presses control chords", () => {
    expect(keyBytes("ctrl+c")).toBe("\x03")
    expect(keyBytes("ctrl+d")).toBe("\x04")
    expect(keyBytes("ctrl+up")).toBe("\x1b[1;5A")
    expect(keyBytes("ctrl+[")).toBe("\x1b")
  })

  it("presses alt and shift chords", () => {
    expect(keyBytes("alt+x")).toBe("\x1bx")
    expect(keyBytes("shift+tab")).toBe("\x1b[Z")
    expect(keyBytes("shift+a")).toBe("A")
  })

  it("types a single character unchanged", () => {
    expect(keyBytes("a")).toBe("a")
    expect(keyBytes("A")).toBe("A")
    expect(keyBytes("?")).toBe("?")
  })

  it("refuses keys it cannot send", () => {
    expect(keyBytes("cmd+l")).toBeNull()
    expect(keyBytes("hyper+a")).toBeNull()
    expect(keyBytes("nonsense")).toBeNull()
    expect(keyBytes("")).toBeNull()
  })
})
