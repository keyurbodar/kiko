import { describe, expect, test } from "bun:test"
import { formatContext, formatPrice, modelRef, searchModels, type CatalogProvider } from "./catalog"

const model = (id: string, name: string) => ({
  id,
  name,
  contextWindow: 128_000,
  maxTokens: 8192,
  reasoning: false,
  pricing: { input: 1, output: 2 },
})
const providers: CatalogProvider[] = [
  { id: "alpha", name: "Alpha", connect: ["api_key"], models: [model("a-fast", "Alpha Fast"), model("a-big", "Alpha Big")] },
  { id: "beta", name: "Beta Labs", connect: ["device_code"], models: [model("b-fast", "Beta Fast")] },
]

describe("catalog helpers", () => {
  test("formats context size", () => {
    expect(formatContext(8192)).toBe("8K")
    expect(formatContext(128_000)).toBe("128K")
    expect(formatContext(1_000_000)).toBe("1M")
    expect(formatContext(512)).toBe("512")
  })
  test("formats price", () => {
    expect(formatPrice({ input: 0, output: 0 })).toBe("Free")
    expect(formatPrice({ input: 0.14, output: 0.28 })).toBe("$0.14 in / $0.28 out per 1M")
    expect(formatPrice({ input: 3, output: 15 })).toBe("$3 in / $15 out per 1M")
  })
  test("search needs every word and matches provider names", () => {
    expect(searchModels(providers, "").length).toBe(3)
    expect(searchModels(providers, "fast").map((r) => r.model.id)).toEqual(["a-fast", "b-fast"])
    expect(searchModels(providers, "beta fast").map((r) => r.model.id)).toEqual(["b-fast"])
    expect(searchModels(providers, "labs").length).toBe(1)
    expect(searchModels(providers, "zzz")).toEqual([])
  })
  test("model ref", () => expect(modelRef("opencode-go", "x")).toBe("opencode-go/x"))
})
