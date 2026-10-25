import type { Api, Model, Provider } from "@earendil-works/pi-ai"
import { describe, expect, it } from "vitest"
import { buildCatalog } from "./build"

const model = (id: string, name: string) =>
  ({ id, name, api: "anthropic-messages", contextWindow: 200_000, maxTokens: 8_000, reasoning: false }) as Model<Api>

const provider = (models: Model<Api>[]) =>
  ({ id: "anthropic", name: "Anthropic", auth: { apiKey: {} }, getModels: () => models }) as unknown as Provider

describe("buildCatalog", () => {
  it("lists a latest alias once under its plain name and hides its dated twin", () => {
    const catalog = buildCatalog(
      [
        provider([
          model("claude-haiku-4-5", "Claude Haiku 4.5 (latest)"),
          model("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
          model("claude-opus-4-1", "Claude Opus 4.1"),
        ]),
      ],
      () => undefined,
    )
    expect(catalog.providers[0]?.models.map((m) => [m.id, m.name])).toEqual([
      ["claude-haiku-4-5", "Claude Haiku 4.5"],
      ["claude-opus-4-1", "Claude Opus 4.1"],
    ])
  })
})
