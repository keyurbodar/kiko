import type { CatalogModel, CatalogProvider } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { modelTrait, pickerEntries, shortModelName, STARRED } from "./model-list"

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
  entries.map((e) => (e.kind === "legacy" ? `legacy ${e.count}${e.open ? " open" : ""}` : `${e.key}@${e.at}`))

const base = { providers: PROVIDERS, starred: [], hidden: [], current: undefined, filter: "a", query: "" }

describe("pickerEntries", () => {
  it("lists one provider's models", () => {
    expect(shape(pickerEntries({ ...base, filter: "b" }))).toEqual(["b/three@0"])
  })

  it("lists only starred models from every provider under the starred filter", () => {
    expect(shape(pickerEntries({ ...base, filter: STARRED, starred: ["b/three", "a/two"] }))).toEqual([
      "a/two@0",
      "b/three@1",
    ])
  })

  it("searches every provider and keeps the current model even when hidden", () => {
    expect(shape(pickerEntries({ ...base, query: "t", hidden: ["a/two", "b/three"], current: "a/two" }))).toEqual([
      "a/two@0",
    ])
  })

  it("folds superseded versions into a legacy group that opens on request", () => {
    const glm = [provider("g", [model("5.2", { name: "GLM 5.2" }), model("5.3", { name: "GLM 5.3" })])]
    const input = { ...base, providers: glm, filter: "g" }
    expect(shape(pickerEntries(input))).toEqual(["g/5.3@0", "legacy 1"])
    expect(shape(pickerEntries({ ...input, legacyOpen: true }))).toEqual(["g/5.3@0", "legacy 1 open", "g/5.2@1"])
  })

  it("keeps a starred or current legacy model in the main list", () => {
    const glm = [provider("g", [model("5.2", { name: "GLM 5.2" }), model("5.3", { name: "GLM 5.3" })])]
    expect(shape(pickerEntries({ ...base, providers: glm, filter: "g", starred: ["g/5.2"] }))).toEqual([
      "g/5.2@0",
      "g/5.3@1",
    ])
    expect(shape(pickerEntries({ ...base, providers: glm, filter: "g", current: "g/5.2" }))).toEqual([
      "g/5.2@0",
      "g/5.3@1",
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
