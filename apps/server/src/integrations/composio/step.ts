import type { Describe } from "../../agent/extensions/presence"
import { MANAGE_CONNECTIONS } from "./connect-tool"
import type { ComposioTool } from "./client"
import { MULTI_EXECUTE, SCHEMAS, SEARCH } from "./learn"
import { toolName } from "./tools"

const capital = (word: string) => (word ? `${word[0]?.toUpperCase()}${word.slice(1)}` : word)

function action(slug: string, toolkit: string): string {
  const prefix = `${toolkit.toLowerCase().split("_")[0]}_`
  const rest = slug.toLowerCase().startsWith(prefix) ? slug.slice(prefix.length) : slug
  return capital(rest.toLowerCase().replace(/_+/g, " ").trim())
}

const toolkitOf = (slug: string) => slug.split("_")[0]?.toLowerCase() ?? ""

export function composioDescribe(tools: readonly ComposioTool[]): Describe {
  const byName = new Map(tools.map((t) => [toolName(t.name), t]))
  return (name, args) => {
    const tool = byName.get(name)
    if (!tool) return null
    if (tool.direct)
      return { label: action(tool.direct.slug, tool.direct.toolkit), app: tool.direct.toolkit.toLowerCase() }
    switch (tool.name) {
      case MULTI_EXECUTE: {
        const slugs = Array.isArray(args.tools)
          ? args.tools.flatMap((t) =>
              typeof (t as { tool_slug?: unknown })?.tool_slug === "string"
                ? [(t as { tool_slug: string }).tool_slug]
                : [],
            )
          : []
        const first = slugs[0]
        if (!first) return null
        const toolkit = toolkitOf(first)
        const more = slugs.length - 1
        return {
          label: `${action(first, toolkit)}${more > 0 ? ` and ${more} more` : ""}`,
          app: toolkit,
          input: JSON.stringify(args),
        }
      }
      case SEARCH:
        return { label: "Searched connected apps" }
      case SCHEMAS:
        return { label: "Read connected app details" }
      case MANAGE_CONNECTIONS:
        return { label: "Managed app connections" }
      default:
        return { label: action(tool.name, "composio"), app: "composio" }
    }
  }
}
