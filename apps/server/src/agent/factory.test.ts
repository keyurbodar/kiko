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

const unused = (): never => {
  throw new Error("the test builds tools without running them")
}

const browser = { connection: unused, lease: unused, acceptsImages: () => false }
const computers = { port: unused, acceptsImages: () => false, desktop: [] }

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

  it("gives every tool one name when the cloud browser and the owner's computers are both on", () => {
    const installed = buildAgent({ role: "worker", lead: false, browser, computers }).registry.snapshot().installed()
    const names = installed.flatMap((extension) => (extension.tools ?? []).map((entry) => entry.name))
    expect(names).toEqual(expect.arrayContaining(["web_read", "web_act", "browser_act", "browser_read"]))
    expect(names.filter((name, at) => names.indexOf(name) !== at)).toEqual([])
  })
})
