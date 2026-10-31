import { MAX_MESSAGE_TEXT } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { bubbleOf } from "./whole-text"

describe("a bubble cut", () => {
  it("keeps short text whole", () => {
    expect(bubbleOf("hello")).toBe("hello")
  })

  it("cuts at the message length before any byte limit", () => {
    expect(bubbleOf("a".repeat(MAX_MESSAGE_TEXT + 10))).toHaveLength(MAX_MESSAGE_TEXT)
  })

  it("never splits a surrogate pair", () => {
    expect(bubbleOf("😀".repeat(MAX_MESSAGE_TEXT / 2 + 1))).toBe("😀".repeat(MAX_MESSAGE_TEXT / 2))
  })

  it("counts a control character as six escaped bytes", () => {
    expect(bubbleOf("\u0001".repeat(20_000))).toHaveLength(10_922)
  })

  it("counts a lone surrogate as six escaped bytes", () => {
    expect(bubbleOf("\uD800".repeat(20_000))).toHaveLength(10_922)
  })

  it("counts a backslash as two escaped bytes", () => {
    expect(bubbleOf("\\".repeat(20_000))).toHaveLength(MAX_MESSAGE_TEXT)
  })

  it("counts a multi-byte character by its utf-8 length", () => {
    expect(bubbleOf("é".repeat(20_000))).toHaveLength(MAX_MESSAGE_TEXT)
  })
})
