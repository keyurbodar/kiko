export type RecipeDoc = {
  title: string
  when: string
  apps: string[]
  agent: { name: string; handle: string } | null
  body: string
}

type Split = { entries: Map<string, string[]>; order: string[]; body: string }

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

function split(text: string): Split | null {
  const match = FENCE.exec(text)
  if (!match) return null
  const entries = new Map<string, string[]>()
  const order: string[] = []
  let current: string | null = null
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const key = /^([A-Za-z][\w-]*):/.exec(line)?.[1]
    if (key) {
      current = key
      entries.set(key, [line])
      order.push(key)
    } else if (current) entries.get(current)?.push(line)
  }
  return { entries, order, body: text.slice(match[0].length) }
}

function join(parts: Split): string {
  const lines = parts.order.flatMap((key) => parts.entries.get(key) ?? [])
  return `---\n${lines.join("\n")}\n---\n${parts.body}`
}

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2")

const scalar = (lines: string[] | undefined) => unquote((lines?.[0] ?? "").replace(/^[^:]*:/, ""))

function list(lines: string[] | undefined): string[] {
  if (!lines) return []
  const inline = /^[^:]*:\s*\[(.*)\]\s*$/.exec(lines[0] ?? "")
  if (inline) {
    return (inline[1] ?? "")
      .split(",")
      .map(unquote)
      .filter((item) => item.length > 0)
  }
  return lines.slice(1).flatMap((line) => {
    const item = /^\s*-\s+(.*)$/.exec(line)?.[1]
    return item ? [unquote(item)] : []
  })
}

function agentOf(lines: string[] | undefined): RecipeDoc["agent"] {
  if (!lines) return null
  const field = (name: string) =>
    unquote(lines.find((line) => new RegExp(`^\\s+${name}:`).test(line))?.replace(/^[^:]*:/, "") ?? "")
  const name = field("name")
  const handle = field("handle")
  return handle ? { name: name || handle, handle } : null
}

export function parseDoc(text: string): RecipeDoc | null {
  const parts = split(text)
  if (!parts) return null
  return {
    title: scalar(parts.entries.get("title")) || scalar(parts.entries.get("name")),
    when: scalar(parts.entries.get("when")),
    apps: list(parts.entries.get("apps")),
    agent: agentOf(parts.entries.get("agent")),
    body: parts.body.replace(/^\r?\n+/, "").replace(/\s+$/, ""),
  }
}

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim()

const quoted = (value: string) =>
  value && !/^[-?:,[\]{}#&*!|>'"%@`]|: | #|:$/.test(value) ? value : JSON.stringify(value)

function put(text: string, key: string, lines: string[] | null): string {
  const parts = split(text)
  if (!parts) return text
  if (lines === null) {
    parts.entries.delete(key)
    parts.order = parts.order.filter((k) => k !== key)
  } else {
    if (!parts.entries.has(key)) parts.order.push(key)
    parts.entries.set(key, lines)
  }
  return join(parts)
}

export function setTitle(text: string, title: string): string {
  return put(text, "title", [`title: ${quoted(oneLine(title))}`])
}

export function setWhen(text: string, when: string): string {
  return put(text, "when", [`when: ${quoted(oneLine(when))}`])
}

export function setApps(text: string, apps: readonly string[]): string {
  return put(text, "apps", [`apps: [${apps.map(oneLine).join(", ")}]`])
}

export function setAgent(text: string, agent: { name: string; handle: string } | null): string {
  return put(
    text,
    "agent",
    agent ? ["agent:", `  name: ${quoted(oneLine(agent.name))}`, `  handle: ${agent.handle}`] : null,
  )
}

export function setBody(text: string, body: string): string {
  const parts = split(text)
  if (!parts) return text
  parts.body = `${body.replace(/\s+$/, "")}\n`
  return join(parts)
}

export function recipeSlugOf(path: string): string | null {
  return /(?:^|\/)recipes\/([^/]+)\/RECIPE\.md$/i.exec(path)?.[1] ?? null
}
