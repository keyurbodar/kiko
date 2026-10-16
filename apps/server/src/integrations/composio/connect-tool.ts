import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import type { ComposioCall, ComposioCallResult, ComposioTool } from "./client"
import { composioErrorText } from "./connect"
import { fillFlags } from "./tools"

export const CONNECT_APP = "composio_connect"
export const MANAGE_CONNECTIONS = "COMPOSIO_MANAGE_CONNECTIONS"

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError } : {}) })

/** The toolkits item is a plain slug or an object, as the session's own schema says. */
function toolkitArgs(tool: ComposioTool, app: string): Record<string, unknown> {
  const props = (tool.inputSchema as { properties?: Record<string, { items?: { type?: unknown } }> }).properties
  const item = props?.toolkits?.items?.type === "object" ? { name: app, action: "add" } : app
  return fillFlags(tool.inputSchema, { toolkits: [item] })
}

const URL_KEYS = ["redirect_url", "redirectUrl", "connect_url", "url", "link"]

/** The first https link under a known key, else the first https link in the text. */
export function connectLink(out: ComposioCallResult): string | undefined {
  const body = out.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n")
  const walk = (v: unknown): string | undefined => {
    if (!v || typeof v !== "object") return undefined
    for (const k of URL_KEYS) {
      const x = (v as Record<string, unknown>)[k]
      if (typeof x === "string" && x.startsWith("https://")) return x
    }
    for (const x of Object.values(v)) {
      const found = walk(x)
      if (found) return found
    }
    return undefined
  }
  try {
    const found = walk(JSON.parse(body))
    if (found) return found
  } catch {}
  return body.match(/https:\/\/[^\s"'<>)\]\\]+/)?.[0]
}

/** The talker's one way to get a link that connects an app, so it never writes a how-to. Absent when the session has no connections tool. */
export function connectAppExtension(tools: readonly ComposioTool[], call: ComposioCall): Extension[] {
  const manage = tools.find((t) => t.name === MANAGE_CONNECTIONS)
  if (!manage) return []
  return [
    defineExtension({
      name: CONNECT_APP,
      tools: [
        declareEffect(
          "external",
          defineTool({
            name: "connect_app",
            description: "get the link that connects one of the human's apps (Gmail, Google Calendar, GitHub, Slack, and others) through Composio. use it when they want an app linked or an app tool says it is not connected. send the link in one line.",
            parameters: Type.Object({ app: Type.String({ description: "the app as people say it, like gmail or google calendar" }) }),
            replay: "safe",
            execute: async ({ app }) => {
              const slug = String(app).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
              if (!slug) return text("name the app to connect.", true)
              try {
                const out = await call(MANAGE_CONNECTIONS, toolkitArgs(manage, slug))
                if (out.isError) return text(out.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").slice(0, 400) || "composio could not make a link.", true)
                const link = connectLink(out)
                if (!link) return text(`no link came back for ${app}. it may already be connected. reply: ${out.content.map((b) => (b.type === "text" ? b.text : "")).join(" ").slice(0, 300)}`)
                return text(`connect link for ${app}: ${link}\nsend it as a markdown link in one line, like [Connect ${app}](${link}). add no steps and no guide.`)
              } catch (e) {
                return text(composioErrorText(e), true)
              }
            },
          }),
        ),
      ],
    }),
  ]
}
