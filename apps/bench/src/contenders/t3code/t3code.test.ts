import { describe, expect, it } from "vitest"

import { AGENT_TOOL_NAMES } from "./constants"
import { startFixture } from "./fixture"
import { agentTools, bashToolSpec, toToolResult } from "./tools"
import { acpReply, relayPayload } from "./shim"
import { settingsJson } from "./settings"
import { diffSnapshot, expectedSnapshot, recordSnapshot } from "./snapshot"
import type { McpTool } from "./mcp"

const tool = (name: string, description = `${name} description`): McpTool => ({
  name,
  description,
  inputSchema: { type: "object", properties: {} },
})

describe("acp shim", () => {
  it("answers initialize with protocol version 1", () => {
    const reply = acpReply(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} }))
    expect(reply).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      result: {
        protocolVersion: 1,
        agentInfo: { name: "kiko-bench-t3code-shim" },
        agentCapabilities: {},
      },
    })
  })

  it("creates a session and ends a prompt turn", () => {
    const created = acpReply(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: {} }))
    expect(created).toMatchObject({ id: 1, result: { sessionId: expect.stringMatching(/^bench-/) } })
    const prompt = acpReply(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { prompt: [] } }))
    expect(prompt).toMatchObject({ id: 2, result: { stopReason: "end_turn" } })
  })

  it("accepts model and mode switches without changing them", () => {
    expect(acpReply(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "session/set_model", params: {} }))).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: {},
    })
    expect(
      acpReply(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "session/set_config_option", params: {} })),
    ).toEqual({ jsonrpc: "2.0", id: 5, result: { configOptions: [] } })
  })

  it("rejects unknown methods and ignores notifications", () => {
    expect(acpReply(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "session/fork" }))).toMatchObject({
      id: 3,
      error: { code: -32601 },
    })
    expect(acpReply(JSON.stringify({ jsonrpc: "2.0", method: "session/cancel" }))).toBeUndefined()
    expect(acpReply("not json")).toBeUndefined()
  })

  it("relays the injected endpoint and credential only when every variable is present", () => {
    expect(
      relayPayload({
        KIKO_BENCH_RELAY: "127.0.0.1:9000",
        KIKO_BENCH_RELAY_TOKEN: "token",
        T3_ACP_MCP_ENDPOINT: "http://127.0.0.1:1/mcp",
        T3_ACP_MCP_AUTHORIZATION: "Bearer x",
      }),
    ).toEqual({
      token: "token",
      endpoint: "http://127.0.0.1:1/mcp",
      authorization: "Bearer x",
    })
    expect(relayPayload({ KIKO_BENCH_RELAY: "127.0.0.1:9000" })).toBeUndefined()
  })
})

describe("agent tool set", () => {
  it("keeps preview, html and worktree tools and drops orchestration", () => {
    const live = [
      tool("preview_open"),
      tool("preview_snapshot"),
      tool("html_preview"),
      tool("html_render"),
      tool("t3_worktree_list"),
      tool("delegate_task"),
      tool("t3_thread_read"),
      tool("t3_preview_list"),
      tool("device_screenshot"),
    ]
    expect(agentTools(live).map((entry) => entry.name)).toEqual([
      "preview_open",
      "preview_snapshot",
      "html_preview",
      "html_render",
      "t3_worktree_list",
    ])
  })

  it("describes bash for the machine shell", () => {
    expect(bashToolSpec("linux").parameters).toMatchObject({
      required: ["command"],
      properties: { command: { type: "string" } },
    })
    expect(bashToolSpec("windows").description).toContain("PowerShell")
  })

  it("maps text, images and structured content into a tool result", () => {
    expect(
      toToolResult({
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
        structuredContent: undefined,
        isError: false,
      }),
    ).toEqual({ text: "hello", images: [{ mime: "image/png", base64: "AAAA" }], isError: false })
    expect(toToolResult({ content: [], structuredContent: { url: "http://x" }, isError: true })).toEqual({
      text: '{"url":"http://x"}',
      images: [],
      isError: true,
    })
  })
})

describe("schema snapshot", () => {
  it("covers exactly the agent tools", () => {
    const snapshot = expectedSnapshot()
    expect(snapshot.t3Version).toBe("0.1.6")
    expect(Object.keys(snapshot.tools).sort()).toEqual([...AGENT_TOOL_NAMES].sort())
  })

  it("records only agent tools and reports drift", () => {
    const live = AGENT_TOOL_NAMES.map((name) => tool(name))
    const snapshot = recordSnapshot(live, { t3Version: "0.1.6", sourceSha: "sha" })
    expect(Object.keys(snapshot.tools).sort()).toEqual([...AGENT_TOOL_NAMES].sort())
    expect(diffSnapshot(snapshot, live)).toEqual([])
    expect(
      diffSnapshot(snapshot, [...live.filter((entry) => entry.name !== "preview_act"), tool("preview_act", "changed")]),
    ).toEqual(["preview_act: description changed"])
    expect(
      diffSnapshot(
        snapshot,
        live.filter((entry) => entry.name !== "html_render"),
      ),
    ).toEqual(["html_render: gone from t3 0.1.6"])
  })
})

describe("provider settings", () => {
  it("registers a local ACP executable with the relay environment", () => {
    const parsed = JSON.parse(
      settingsJson({
        shimCommand: "/usr/bin/bun",
        shimArgs: ["/repo/shim.ts"],
        environment: [{ name: "KIKO_BENCH_RELAY", value: "127.0.0.1:9000" }],
      }),
    )
    expect(parsed.providerInstances["bench-t3code"]).toMatchObject({
      driver: "acpRegistry",
      enabled: true,
      environment: [{ name: "KIKO_BENCH_RELAY", value: "127.0.0.1:9000" }],
      config: {
        source: "local",
        commandPath: "/usr/bin/bun",
        commandArgs: ["/repo/shim.ts"],
      },
    })
  })
})

describe("fixture", () => {
  it("serves the page and records a click", async () => {
    const fixture = await startFixture()
    try {
      const page = await fetch(fixture.url)
      expect(await page.text()).toContain("Click me")
      const clicked = await fetch(new URL("/click", fixture.url), { method: "POST" })
      expect(clicked.status).toBe(204)
      expect(await fixture.clicked).toBe(1)
      const counts = await fetch(new URL("/clicks", fixture.url))
      expect(await counts.json()).toEqual({ count: 1 })
    } finally {
      await fixture.close()
    }
  })
})
