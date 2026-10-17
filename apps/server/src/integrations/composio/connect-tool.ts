import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import type { ComposioCall, ComposioCallResult, ComposioTool } from "./client"
import { composioErrorText } from "./connect"
import { fillFlags } from "./tools"

const CONNECT_APP = "composio_connect"
export const MANAGE_CONNECTIONS = "COMPOSIO_MANAGE_CONNECTIONS"

const text = (t: string, isError = false) => ({ output: [{ type: "text" as const, text: t }], ...(isError ? { isError } : {}) })

/** The toolkits item is a plain slug or an object, as the session's own schema says. */
function toolkitArgs(tool: ComposioTool, toolkit: string): Record<string, unknown> {
  const props = (tool.inputSchema as { properties?: Record<string, { items?: { type?: unknown } }> }).properties
  const item = props?.toolkits?.items?.type === "object" ? { name: toolkit, action: "add" } : toolkit
  return fillFlags(tool.inputSchema, { toolkits: [item] })
}

const URL_KEYS = ["redirect_url", "redirectUrl", "connect_url", "url", "link"]

/** The first https link under a known key, else the first https link in the text. */
function connectLink(out: ComposioCallResult): string | undefined {
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

/**
 * Why Composio refused a toolkit. A wrong slug comes back as a successful MCP result whose body says
 * "toolkit not found", so a caller that reads only `isError` reports nothing and the agent says
 * "it may already be connected".
 */
function refusal(out: ComposioCallResult): string | undefined {
  const body = out.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n")
  try {
    const parsed = JSON.parse(body) as { data?: { results?: Record<string, { status?: unknown; error_message?: unknown; instruction?: unknown }> }; error?: unknown }
    for (const [toolkit, result] of Object.entries(parsed.data?.results ?? {})) {
      if (result?.status === "failed") return String(result.error_message ?? `composio could not connect ${toolkit}.`)
      if (result?.status === "active") return undefined
      if (typeof result?.instruction === "string" && /does not require authentication/i.test(result.instruction)) return undefined
    }
    if (typeof parsed.error === "string" && parsed.error) return parsed.error
  } catch {}
  return undefined
}

type ConnectLink = { kind: "link"; link: string } | { kind: "none"; reply: string } | { kind: "error"; error: string }

/**
 * The toolkit a person named, as Composio's slug. "Google Calendar" must reach Composio as
 * `googlecalendar`: the manage tool answers "toolkit not found" inside a successful result for
 * `google_calendar`, so an agent that never resolves the name gets no link.
 */
export type ResolveToolkit = (app: string) => Promise<string | null>

/** One link that connects one app, made the one way both the connect_app tool and the recipe gate make it. */
export async function connectLinkFor(manage: ComposioTool, call: ComposioCall, app: string, resolve?: ResolveToolkit): Promise<ConnectLink> {
  const named = app.trim()
  if (!named) return { kind: "error", error: "name the app to connect." }
  try {
    const resolved = resolve ? await resolve(named) : null
    if (resolve && !resolved) return { kind: "error", error: `composio has no app called ${named}.` }
    const slug = resolved ?? named.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
    const out = await call(MANAGE_CONNECTIONS, toolkitArgs(manage, slug))
    if (out.isError) {
      const body = out.content.map((b) => (b.type === "text" ? b.text : "")).join(" ")
      return { kind: "error", error: body.slice(0, 400) || "composio could not make a link." }
    }
    const refused = refusal(out)
    if (refused) return { kind: "error", error: refused.slice(0, 400) }
    const link = connectLink(out)
    return link ? { kind: "link", link } : { kind: "none", reply: out.content.map((b) => (b.type === "text" ? b.text : "")).join(" ").slice(0, 300) }
  } catch (e) {
    return { kind: "error", error: composioErrorText(e) }
  }
}

/** The talker's one way to get a link that connects an app, so it never writes a how-to. Absent when the session has no connections tool. */
export function connectAppExtension(tools: readonly ComposioTool[], call: ComposioCall, resolve?: ResolveToolkit): Extension[] {
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
            description:
              "get the one link that connects an app through Composio, such as Gmail, Google Calendar, GitHub, Slack, or web search. use it the moment you need a capability the human has not connected, and say in one line why you need it. send the link as one markdown link and add no steps.",
            parameters: Type.Object({ app: Type.String({ description: "the app or capability as people say it, like gmail, google calendar, or web search" }) }),
            replay: "safe",
            execute: async ({ app }) => {
              const out = await connectLinkFor(manage, call, String(app), resolve)
              if (out.kind === "error") return text(out.error, true)
              if (out.kind === "none") return text(`no link came back for ${app}. it may already be connected. reply: ${out.reply}`)
              return text(`connect link for ${app}: ${out.link}\nsend it as a markdown link in one line, like [Connect ${app}](${out.link}). say in one line what you need it for. add no steps and no guide.`)
            },
          }),
        ),
      ],
    }),
  ]
}
