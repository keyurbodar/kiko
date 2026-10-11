import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// Encodes the "ways to hurt yourself" rules of AGENTS.md. A violation is `file:line rule-id message`.
// Escape: put `// check-rules: allow <rule-id> <reason>` on the line above. The reason must be non-empty.

type Rule = {
  id: string
  description: string
  roots: readonly string[]
  skip?: (path: string) => boolean
  match: (line: string) => boolean
  enforce: boolean
}

const ROOT = join(import.meta.dir, "..")
const SERVER_AND_CORE = ["apps/server/src", "core/agent/src", "core/memory/src", "core/sandbox/src", "core/durable/src"]
const ALL_SRC = ["apps/server/src", ...["agent", "browser", "durable", "memory", "protocol", "sandbox"].map((p) => `core/${p}/src`)]
const isTest = (path: string) => /(^|\/)test\/|\.test\.tsx?$/.test(path)

export const RULES: readonly Rule[] = [
  {
    id: "no-timer-in-do",
    description: "setTimeout and setInterval do not survive eviction. Use alarm.ts.",
    roots: SERVER_AND_CORE,
    match: (line) => /(?<![\w.])(setTimeout|setInterval)\(/.test(line),
    enforce: false,
  },
  {
    id: "do-names",
    description: "Only apps/server/src/lib/names.ts builds a Durable Object name.",
    roots: ALL_SRC,
    skip: (path) => path === "apps/server/src/lib/names.ts" || isTest(path),
    match: (line) => /\.(idFromName|idFromString)\(/.test(line),
    enforce: true,
  },
  {
    id: "dev-guard",
    description: "process.env.NODE_ENV is read in one dev guard module only.",
    roots: ALL_SRC,
    match: (line) => line.includes("process.env.NODE_ENV"),
    enforce: false,
  },
  {
    id: "egress",
    description: "A bare fetch( call goes through safe-fetch or AgentDO.egress.",
    roots: ALL_SRC,
    skip: (path) => path === "core/durable/src/safe-fetch.ts" || path === "apps/server/src/agent/agent-do.ts",
    match: (line) => /(?<![\w.$])fetch\(/.test(line) && !/\b(async|private|public|static|function)\s+fetch\(/.test(line) && !/^\s*fetch\(.*\)\s*(:[^{]*)?\{\s*$/.test(line),
    enforce: false,
  },
  {
    id: "sql-list-binds",
    description: "Do not bind one SQL value per list item. Pass one JSON value and read it with json_each(?).",
    roots: ALL_SRC,
    skip: isTest,
    match: (line) => /\.map\(\(\s*[\w_]*\s*\)\s*=>\s*["'`]\?["'`]\)|["'`]\?,["'`]\.repeat\(|["'`]\?["'`]\.repeat\(|\.fill\(["'`]\?["'`]\)/.test(line),
    enforce: true,
  },
]

function files(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap((name) => {
    if (name === "node_modules" || name === ".wrangler") return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !name.endsWith(".gen.ts") ? [path] : []
  })
}

const ALLOW = /\/\/\s*check-rules:\s*allow\s+(\S+)\s*(.*)$/

export function scan(rules: readonly Rule[], read: (path: string) => string = (p) => readFileSync(p, "utf8")) {
  const found: { rule: Rule; at: string; text: string }[] = []
  const cache = new Map<string, string[]>()
  for (const rule of rules) {
    const seen = new Set<string>()
    for (const root of rule.roots) {
      for (const file of files(join(ROOT, root))) {
        const rel = relative(ROOT, file)
        if (seen.has(rel) || rule.skip?.(rel)) continue
        seen.add(rel)
        let lines = cache.get(rel)
        if (!lines) cache.set(rel, (lines = read(file).split("\n")))
        lines.forEach((line, i) => {
          const code = line.trim()
          if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*") || !rule.match(line)) return
          const allow = i > 0 ? ALLOW.exec(lines[i - 1] ?? "") : null
          if (allow?.[1] === rule.id && allow[2]?.trim()) return
          found.push({ rule, at: `${rel}:${i + 1}`, text: code.slice(0, 100) })
        })
      }
    }
  }
  return found
}

if (import.meta.main) {
  const start = performance.now()
  const found = scan(RULES)
  for (const { rule, at, text } of found) console.log(`${at} ${rule.id} ${rule.enforce ? "" : "(report only) "}${text}`)
  const lines = RULES.map((rule) => {
    const n = found.filter((f) => f.rule === rule).length
    return `${rule.id}: ${n} ${rule.enforce ? "enforced" : "report only"}`
  })
  const failed = found.some((f) => f.rule.enforce)
  console.log(`${lines.join("; ")}\ncheck-rules ${failed ? "FAILED" : "ok"} in ${Math.round(performance.now() - start)} ms`)
  process.exit(failed ? 1 : 0)
}
