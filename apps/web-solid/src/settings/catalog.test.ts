import type { AgentModel, Catalog } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { withLiveLevels } from "./catalog"

const catalog = (thinking: AgentModel["thinkingLevels"]): Catalog =>
  ({
    providers: [{ id: "openai", models: [{ id: "gpt-5/mini", thinking }] }],
  }) as unknown as Catalog

const stored: AgentModel = { model: "openai/gpt-5/mini", thinking: "off", thinkingLevels: ["off"] }

describe("withLiveLevels", () => {
  it("shows the catalog's levels when the stored ones are stale", () => {
    expect(withLiveLevels(stored, catalog(["low", "medium", "high"]))).toEqual({
      ...stored,
      thinking: "medium",
      thinkingLevels: ["low", "medium", "high"],
    })
  })

  it("keeps the stored model while the catalog loads or misses it", () => {
    expect(withLiveLevels(stored, undefined)).toBe(stored)
    expect(withLiveLevels({ ...stored, model: "openai/other" }, catalog(["high"]))).toEqual({
      ...stored,
      model: "openai/other",
    })
  })
})
