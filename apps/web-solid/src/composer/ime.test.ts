import { describe, expect, test } from "bun:test"
import { composingKey } from "./ime"

describe("composingKey", () => {
  test("a key during composition is composing", () => {
    expect(composingKey({ isComposing: true, keyCode: 13 })).toBe(true)
  })

  test("the Enter that commits a Safari composition is composing, though isComposing is false", () => {
    expect(composingKey({ isComposing: false, keyCode: 229 })).toBe(true)
  })

  test("an ordinary Enter is not composing", () => {
    expect(composingKey({ isComposing: false, keyCode: 13 })).toBe(false)
  })
})
