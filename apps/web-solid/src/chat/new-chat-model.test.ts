import { describe, expect, test } from "bun:test"
import type { Agent, AgentSlug } from "@kiko/protocol"
import { agentList, BUILTIN_AGENT } from "./new-chat-model"

describe("new chat model", () => {
  test("kiko comes first and is never listed twice", () => {
    const ada: Agent = { id: "1", name: "ada", slug: "ada" as AgentSlug, prompt: "reads code", model: "" }
    expect(agentList([ada]).map((a) => a.id)).toEqual(["kiko", "1"])
    expect(agentList([BUILTIN_AGENT, ada]).map((a) => a.id)).toEqual(["kiko", "1"])
  })
})
