import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import { describe, expect, it } from "vitest"
import { buildAgent } from "./factory"

const tool = (name: string) =>
  defineTool({
    name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => ({ output: [{ type: "text" as const, text: "ok" }] }),
  })

describe("buildAgent", () => {
  it("runs a round with a writing tool one call at a time and leaves reads parallel", () => {
    const test = defineExtension({
      name: "test-tools",
      tools: [declareEffect("write", tool("scribble")), declareEffect("read", tool("peek"))],
    })
    const built = buildAgent({ role: "talker", lead: true, testExtensions: [test] })
    const extensions = built.agent.extensions as readonly Extension[]
    const tools = extensions.find((e) => e.name === "test-tools")?.tools ?? []
    expect(tools.find((t) => t.name === "scribble")?.executionMode).toBe("sequential")
    expect(tools.find((t) => t.name === "peek")?.executionMode).toBeUndefined()
  })
})
