import { describe, expect, test } from "bun:test"
import { hasModelProvider, modelProviders } from "./provider-kinds"

describe("model providers", () => {
  test("typesafe alone is not a model provider", () => {
    expect(hasModelProvider([{ provider: "typesafe" }])).toBe(false)
    expect(hasModelProvider([])).toBe(false)
  })
  test("typesafe is dropped from the count and real providers stay", () => {
    const saved = [{ provider: "typesafe" }, { provider: "anthropic" }]
    expect(modelProviders(saved)).toEqual([{ provider: "anthropic" }])
    expect(hasModelProvider(saved)).toBe(true)
  })
})
