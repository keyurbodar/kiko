import type { CatalogModel, CatalogProvider } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { ALL_PROVIDERS, modelTrait, pickerEntries, shortModelName, STARRED } from "./model-list"

const model = (id: string, over: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  name: id,
  contextWindow: 128_000,
  maxTokens: 8_000,
  reasoning: true,
  thinking: ["off", "low", "high"],
  pricing: { input: 1, output: 4 },
  ...over,
})

const provider = (id: string, models: CatalogModel[]): CatalogProvider => ({
  id,
  name: id.toUpperCase(),
  connect: ["api_key"],
  models,
  classifiers: 0,
})

const PROVIDERS = [provider("a", [model("one"), model("two")]), provider("b", [model("three")])]

const shape = (entries: ReturnType<typeof pickerEntries>) =>
  entries.map((e) => (e.kind === "head" ? `# ${e.label}` : `${e.key}@${e.at}`))

const base = { providers: PROVIDERS, starred: [], hidden: [], current: undefined, filter: ALL_PROVIDERS, query: "" }

describe("pickerEntries", () => {
  it("labels each provider and lists starred models first, once", () => {
    expect(shape(pickerEntries({ ...base, starred: ["b/three"] }))).toEqual([
      "# Starred",
      "b/three@0",
      "# A",
      "a/one@1",
      "a/two@2",
    ])
  })

  it("shows one provider without labels when filtered", () => {
    expect(shape(pickerEntries({ ...base, filter: "a", starred: ["a/one"] }))).toEqual(["a/one@0", "a/two@1"])
  })

  it("lists only starred models from every provider under the starred filter", () => {
    expect(shape(pickerEntries({ ...base, filter: STARRED, starred: ["b/three", "a/two"] }))).toEqual([
      "a/two@0",
      "b/three@1",
    ])
  })

  it("searches without labels and keeps the current model even when hidden", () => {
    expect(shape(pickerEntries({ ...base, query: "t", hidden: ["a/two", "b/three"], current: "a/two" }))).toEqual([
      "a/two@0",
    ])
  })
})

describe("modelTrait", () => {
  it("names one plain trait instead of a price", () => {
    expect(modelTrait(model("x", { pricing: { input: 0, output: 0 } }))).toBe("Free")
    expect(modelTrait(model("x", { contextWindow: 1_000_000 }))).toBe("1M context")
    expect(modelTrait(model("x", { pricing: { input: 0.3, output: 1.2 } }))).toBe("Fast")
    expect(modelTrait(model("x", { contextWindow: 1_000_000, pricing: { input: 0.3, output: 1.2 } }))).toBe("Fast")
    expect(modelTrait(model("x"))).toBe("Smart")
  })
})

describe("shortModelName", () => {
  it("drops the family word from long names so the phone chip fits", () => {
    expect(shortModelName("DeepSeek V4.1 Flash")).toBe("Flash")
    expect(shortModelName("Claude Opus 4.1")).toBe("Opus")
    expect(shortModelName("GPT-5")).toBe("GPT-5")
  })
})
