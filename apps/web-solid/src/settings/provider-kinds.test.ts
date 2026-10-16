import { describe, expect, test } from "bun:test"
import type { CatalogProvider } from "./catalog"
import { hasModelProvider, isJudgeOnly, modelProviders } from "./provider-kinds"

const entry = (models: number, classifiers: number): CatalogProvider => ({
  id: "x",
  name: "x",
  connect: ["api_key"],
  models: Array.from({ length: models }, (_, i) => ({ id: `m${i}`, name: `m${i}`, contextWindow: 1, maxTokens: 1, reasoning: false, thinking: ["off"], pricing: { input: 0, output: 0 } })),
  classifiers,
})

describe("model providers", () => {
  test("a key the server marks as no chat is not a model provider", () => {
    expect(hasModelProvider([{ chat: false }])).toBe(false)
    expect(hasModelProvider([])).toBe(false)
  })
  test("a judge-only key is dropped from the count and chat providers stay, whatever their id", () => {
    const saved = [
      { provider: "typesafe", chat: false, judge: true },
      { provider: "opencode", chat: true, judge: true },
      { provider: "anthropic", chat: true },
    ]
    expect(modelProviders(saved).map((p) => p.provider)).toEqual(["opencode", "anthropic"])
    expect(hasModelProvider(saved)).toBe(true)
  })
})

describe("judge providers", () => {
  test("only a catalog entry with classifier models and no chat models is a judge-only provider", () => {
    expect(isJudgeOnly(entry(0, 1))).toBe(true)
    expect(isJudgeOnly(entry(3, 2))).toBe(false)
    expect(isJudgeOnly(entry(3, 0))).toBe(false)
    expect(isJudgeOnly(entry(0, 0))).toBe(false)
  })
})
