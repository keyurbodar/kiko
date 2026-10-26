import type { AgentModel } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { pickedModel } from "./model-pick"

const haiku: AgentModel = {
  model: "anthropic/claude-haiku-4-5",
  name: "Claude Haiku 4.5 (latest)",
  thinking: "medium",
  thinkingLevels: ["off", "low", "medium", "high"],
}

describe("pickedModel", () => {
  it("keeps the model's name when only the reasoning level changes", () => {
    expect(pickedModel(haiku, { thinking: "off" })).toEqual({ ...haiku, thinking: "off" })
  })

  it("takes the new model's name and levels when the model changes", () => {
    expect(pickedModel(haiku, { ref: "openai/gpt-5", name: "GPT-5", levels: ["low", "high"] })).toEqual({
      model: "openai/gpt-5",
      name: "GPT-5",
      thinking: "high",
      thinkingLevels: ["low", "high"],
    })
  })

  it("drops the old name for a new model that arrives without one", () => {
    expect(pickedModel(haiku, { ref: "openai/gpt-5", levels: ["off"] })?.name).toBeUndefined()
  })

  it("has nothing to show before any model is known", () => {
    expect(pickedModel(undefined, { thinking: "low" })).toBeUndefined()
  })
})
