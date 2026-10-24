import type { Agent, AgentSlug } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { newChatMembers } from "./chats"

const scout: Agent = { id: "a1", name: "Scout", slug: "scout" as AgentSlug, prompt: "", model: "m" }
const coder: Agent = { id: "a2", name: "Coder", slug: "coder" as AgentSlug, prompt: "", model: "m" }

describe("newChatMembers", () => {
  it("leads a one-agent chat with that agent", () => {
    expect(newChatMembers(["a1"], [scout, coder])).toEqual([{ slug: "scout", name: "Scout", lead: true }])
  })

  it("falls back to Kiko when no chosen agent is known", () => {
    expect(newChatMembers(["gone"], [scout])).toEqual([{ slug: "kiko", name: "Kiko", lead: true }])
    expect(newChatMembers(undefined, [scout])).toEqual([{ slug: "kiko", name: "Kiko", lead: true }])
  })

  it("puts Kiko first as lead in a group", () => {
    expect(newChatMembers(["a1", "a2"], [scout, coder])).toEqual([
      { slug: "kiko", name: "Kiko", lead: true },
      { slug: "scout", name: "Scout", lead: false },
      { slug: "coder", name: "Coder", lead: false },
    ])
  })
})
