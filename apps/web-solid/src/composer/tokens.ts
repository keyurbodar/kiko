import { fileRefToken } from "./rich/file-ref"

export type Trigger = "@" | "/"

export type Token =
  | { kind: "agent"; id: string; slug: string; title: string; hint: string }
  | { kind: "file"; id: string; path: string; title: string; hint: string }
  | { kind: "app"; id: string; slug: string; title: string; hint: string }
  | { kind: "skill" | "recipe"; id: string; name: string; title: string; hint: string }
  | { kind: "command"; id: string; trigger: string; title: string; hint: string }
  | { kind: "action"; id: string; title: string; hint: string }

export type TokenKind = Token["kind"]

export type TokenGroup = { kind: TokenKind; label: string; items: Token[] }

export type TokenPool = {
  agents: () => readonly Token[]
  files: (query: string) => readonly Token[]
  apps: () => readonly Token[]
  skills: () => readonly Token[]
  recipes: () => readonly Token[]
  commands: () => readonly Token[]
  actions?: () => readonly Token[]
}

const LABELS: Record<TokenKind, string> = {
  agent: "Agents",
  file: "Files",
  app: "Apps",
  skill: "Skills",
  recipe: "Recipes",
  command: "Commands",
  action: "",
}

const LIMIT: Record<TokenKind, number> = { agent: 6, file: 5, app: 5, skill: 6, recipe: 5, command: 8, action: 1 }

function tokenKey(token: Token): string {
  if (token.kind === "agent" || token.kind === "app") return token.slug
  if (token.kind === "file") return token.path
  if (token.kind === "command") return token.trigger
  if (token.kind === "action") return token.id
  return token.name
}

export function tokenText(token: Token): string {
  if (token.kind === "agent" || token.kind === "app") return `@${token.slug}`
  if (token.kind === "file") return fileRefToken(token.path)
  if (token.kind === "command") return `/${token.trigger}`
  if (token.kind === "action") return ""
  return `/${token.name}`
}

function score(token: Token, query: string): number {
  const q = query.toLowerCase()
  if (!q) return 1
  const title = token.title.toLowerCase()
  const key = tokenKey(token).toLowerCase()
  if (title.startsWith(q) || key.startsWith(q)) return 3
  if (title.split(/[\s-]+/).some((word) => word.startsWith(q)) || key.split("-").some((w) => w.startsWith(q))) return 2
  return title.includes(q) || key.includes(q) ? 1 : 0
}

function pick(kind: TokenKind, items: readonly Token[], query: string, ranked = false): TokenGroup {
  const matched = ranked
    ? items
    : items
        .map((token, index) => ({ token, index, score: score(token, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((entry) => entry.token)
  return { kind, label: LABELS[kind], items: matched.slice(0, LIMIT[kind]) }
}

export function tokenGroups(pool: TokenPool, trigger: Trigger, query: string, atStart: boolean): TokenGroup[] {
  const groups =
    trigger === "@"
      ? [
          pick("agent", pool.agents(), query),
          pick("file", pool.files(query), query, true),
          pick("app", pool.apps(), query),
          pick("action", pool.actions?.() ?? [], query, true),
        ]
      : [
          pick("skill", pool.skills(), query),
          pick("recipe", pool.recipes(), query),
          ...(atStart ? [pick("command", pool.commands(), query)] : []),
        ]
  return groups.filter((group) => group.items.length > 0)
}

const SKILL_FILE = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/

export function skillNames(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap((path) => SKILL_FILE.exec(path)?.[1] ?? []))].sort()
}

export function titleOf(name: string): string {
  const spaced = name.replace(/-/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
