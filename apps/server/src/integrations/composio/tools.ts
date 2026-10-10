import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import { spill } from "../../agent/extensions/spill"
import type { RoomFs } from "../../files/room-fs"
import { count } from "../../lib/dev-stats"
import type { ComposioCall, ComposioTool } from "./client"

export const COMPOSIO = "composio"

/** Composio tools agents never get, and why. */
export const HIDDEN: Readonly<Record<string, string>> = {
  COMPOSIO_REMOTE_BASH_TOOL: "the workbench covers it",
  COMPOSIO_SUBMIT_FEEDBACK: "feedback to Composio is not the agent's to send",
  COMPOSIO_MANAGE_SKILL: "yuki has its own skills",
  COMPOSIO_SEARCH_SKILLS: "yuki has its own skills",
  COMPOSIO_USE_SKILL: "yuki has its own skills",
}

/** `COMPOSIO_SEARCH_TOOLS` becomes `composio_search_tools`. */
export const toolName = (name: string) => `composio_${name.replace(/^COMPOSIO_/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`.slice(0, 64)

export function composioExtension(tools: readonly ComposioTool[], call: ComposioCall, fs?: RoomFs): Extension {
  return defineExtension({
    name: COMPOSIO,
    tools: tools
      .filter((t) => !(t.name in HIDDEN))
      .map((t) =>
        declareEffect(
          t.readOnly ? "read" : "external",
          defineTool({
            name: toolName(t.name),
            description: `${t.description?.trim() || t.name} (through composio, the human's connected apps)`,
            parameters: t.inputSchema as never,
            replay: t.readOnly ? "safe" : "unsafe",
            execute: async (args) => {
              const name = toolName(t.name)
              count(`composio.call.${name}`)
              try {
                const sent = performance.now()
                const out = await call(t.name, (args ?? {}) as Record<string, unknown>)
                count(`composio.${name}.ms`, Math.round(performance.now() - sent))
                if (!out.content.length) return { content: [{ type: "text" as const, text: "(no output)" }], isError: out.isError }
                const content = await Promise.all(out.content.map(async (b) => (b.type === "text" ? { ...b, text: await spill(fs, `composio-${name}`, b.text) } : b)))
                return { content, isError: out.isError }
              } catch (e) {
                return { content: [{ type: "text" as const, text: `composio did not answer: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
              }
            },
          }),
          { outside: "composio" },
        ),
      ),
  })
}
