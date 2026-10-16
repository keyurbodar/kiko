import { describe, expect, test } from "bun:test"
import type { AgentSlug } from "@kiko/protocol"
import { DEFAULT_MODEL } from "../src/agent/factory"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import { type MemberRow, toMember } from "../src/room/members"
import { clampThinking } from "@kiko/protocol"
import { supportedThinking, thinkingFor } from "../src/agent/thinking"

const row = (model: string, thinking: MemberRow["thinking"] = ""): MemberRow => ({ slug: "ada" as AgentSlug, name: "ada", role: "", model, thinking, lead: true, status: "idle" })

describe("toMember model", () => {
  test("an agent with no model of its own reports the default", () =>
    expect(toMember(row("")).model).toBe(`${DEFAULT_MODEL.provider}/${DEFAULT_MODEL.modelId}`))
  test("an agent's own model wins", () => expect(toMember(row("opencode-go/deepseek-v4.1-flash")).model).toBe("opencode-go/deepseek-v4.1-flash"))
})

const REASONER = { provider: "anthropic", modelId: "claude-opus-4-6" }
const PLAIN = { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" }

describe("reasoning levels come from pi-ai", () => {
  test("a model offers its own levels, and a model that cannot reason offers only off", () => {
    expect(supportedThinking(REASONER)).toContain("high")
    const plain = supportedThinking(PLAIN)
    expect(plain.length).toBeGreaterThan(0)
    expect(supportedThinking({ provider: "nobody", modelId: "none" })).toEqual(["off"])
  })
  test("an agent starts at the lowest level its model offers that is not off", () => {
    const first = supportedThinking(REASONER).find((l) => l !== "off")
    expect(thinkingFor(REASONER)).toBe(first ?? "off")
  })
  test("a wanted level the model lacks is clamped to one it has", () => {
    const supported = supportedThinking(REASONER)
    expect(supported).toContain(thinkingFor(REASONER, "max"))
    expect(supported).toContain(thinkingFor(REASONER, "xhigh"))
    expect(thinkingFor({ provider: "nobody", modelId: "none" }, "high")).toBe("off")
  })
  test("the member list carries each member's own level", () => {
    expect(toMember(row("anthropic/claude-opus-4-6", "high")).thinking).toBe("high")
    expect(toMember(row("anthropic/claude-opus-4-6")).thinking).toBe(thinkingFor(REASONER))
  })
})

describe("clampThinking", () => {
  test("agrees with pi-ai for every model and every level", () => {
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const
    for (const provider of builtinProviders()) {
      for (const model of provider.getModels()) {
        const supported = supportedThinking({ provider: provider.id, modelId: model.id })
        for (const level of levels) expect(clampThinking(supported, level)).toBe(thinkingFor({ provider: provider.id, modelId: model.id }, level))
      }
    }
  })
})
