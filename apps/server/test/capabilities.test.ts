import { describe, expect, test } from "bun:test"
import { effectOf } from "@kiko/agent/effects"
import { buildAgent } from "../src/agent/factory"
import { forRole } from "../src/agent/roles"
import { baseSections, integrationNote } from "../src/agent/prompt"
import { connectAppExtension } from "../src/integrations/composio/connect-tool"

const manage = { name: "COMPOSIO_MANAGE_CONNECTIONS", inputSchema: { type: "object", properties: { toolkits: { type: "array", items: { type: "string" } }, reinitiate_all: { type: "boolean" } }, required: ["toolkits", "reinitiate_all"] } }
type Run = (args: unknown, api: unknown) => Promise<{ output: { text?: string }[]; isError?: boolean }>

describe("capabilities", () => {
  test("every agent's prompt names the tools for private talk, groups, apps, and work", () => {
    const render = (lead: boolean) => baseSections({ role: "", lead }).map((s) => (s as unknown as { render?: () => string | undefined }).render?.() ?? "").join("\n")
    for (const lead of [true, false]) {
      const text = render(lead)
      for (const tool of ["send_message", "create_group", "connect_app", "start_work"]) expect(text).toContain(tool)
      expect(text).toMatch(/never wait to be asked/i)
      expect(text).not.toContain("wakes nobody")
    }
  })

  test("the context says when composio is not set up, and when it is", () => {
    expect(integrationNote(null, false)).toContain("composio is not set up")
    expect(integrationNote(null, false)).toContain("Kernel browser is not connected")
    expect(integrationNote([], true)).toContain("composio is set up")
    expect(integrationNote([], true)).toContain("Kernel browser is connected")
    expect(integrationNote("unreachable", true)).not.toContain("composio")
  })

  test("connect_app is a talker tool with effect external that returns a link to send in one line", async () => {
    const sent: unknown[] = []
    const [ext] = connectAppExtension([manage], async (name, args) => {
      sent.push([name, args])
      return { content: [{ type: "text", text: JSON.stringify({ data: { results: { gmail: { redirect_url: "https://connect.composio.dev/link/abc" } } } }) }] }
    })
    expect(forRole([ext!], "talker")).toHaveLength(1)
    const tool = ext!.tools![0]!
    expect(effectOf(tool)).toBe("external")
    const out = await (tool as unknown as { execute: Run }).execute({ app: "Gmail" }, { conversationId: "c", callId: "1" })
    expect(sent).toEqual([["COMPOSIO_MANAGE_CONNECTIONS", { toolkits: ["gmail"], reinitiate_all: false }]])
    expect(out.output[0]!.text).toContain("https://connect.composio.dev/link/abc")
    expect(out.output[0]!.text).toContain("markdown link in one line")
  })

  test("connect_app is absent without composio", () => {
    const names = (composio?: Parameters<typeof buildAgent>[0]["composio"]) =>
      (buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "m" }, ...(composio ? { composio } : {}) }).agent.extensions as { tools?: { name: string }[] }[]).flatMap((e) => e.tools?.map((t) => t.name) ?? [])
    expect(names()).not.toContain("connect_app")
    expect(names({ tools: [manage], call: async () => ({ content: [] }) })).toContain("connect_app")
  })
})
