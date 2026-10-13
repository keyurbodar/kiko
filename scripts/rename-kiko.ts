import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const DRY = process.argv.includes("--dry-run")

const SKIP_PATH = [
  /^refs\//,
  /^bun\.lock$/,
  /^scripts\/rename-kiko\.ts$/,
  /^issues\/(ledger\.tsv|decisions\.tsv|STANDING\.md)$/,
  /^issues\/evidence\//,
  /^issues\/G\d+-/,
]

const isCode = (path: string) => /\.(tsx?|jsx?|mjs|json|jsonc|html)$/.test(path) && !/(^|\/)package\.json$/.test(path)

// Each entry is kept as it is. A literal is data that is stored or sent outside this repo.
const KEEP: { name: string; re: RegExp; when?: (path: string) => boolean }[] = [
  { name: "legacy config dir", re: /\.config\/yuki/g },
  { name: "IndexedDB name", re: /yuki[:-]warm:/g },
  { name: "composio user id prefix", re: /yuki_\$\{/g },
  { name: "chief home setting key", re: /yuki_home/g },
  { name: "chief handle in a mention", re: /@[Yy]uki\b(?!\/)/g },
  { name: "extension manifest key", re: /\\?"yuki\\?": 1|\byuki: 1\b/g },
  { name: "chip label of the chief slug", re: /(["'])yuki ×\1/g, when: isCode },
  { name: "bird flavor and font id", re: /\byuki(?=: \{ label|: INTERFACE_FONTS)|INTERFACE_FONTS\.yuki/g, when: isCode },
  { name: "extension manifest key in code", re: /\bvalue\.yuki\b|\byuki: typeof EXTENSION_SDK|"yuki" must be/g },
  { name: "agent slug and extension scope", re: /(\\?)(["'])yuki\1\2/g, when: isCode },
]

type Rule = { name: string; re: RegExp; to: string | ((...m: string[]) => string) }
const RULES: Rule[] = [
  { name: "package scope", re: /@yuki\b/g, to: "@kiko" },
  { name: "env and constants", re: /\bYUKI(?=[_-]|\b)|\bVITE_YUKI_/g, to: (m) => m.replace("YUKI", "KIKO") },
  { name: "capital Yuki", re: /Yuki/g, to: "Kiko" },
  { name: "camel identifier", re: /yuki(?=[A-Z])/g, to: "kiko" },
  { name: "lower yuki", re: /yuki/g, to: "kiko" },
]

const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter((p) => p && !SKIP_PATH.some((re) => re.test(p)) && !lstatSync(join(ROOT, p)).isSymbolicLink())

const perRule = new Map<string, number>()
const perFile = new Map<string, number>()
const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n)
const kept = new Map<string, number>()

const MARK = (n: number) => `${n}`
const stripKept = (path: string, text: string) => {
  const spans: string[] = []
  let out = text
  for (const k of KEEP) {
    if (k.when && !k.when(path)) continue
    out = out.replace(k.re, (m) => {
      spans.push(m)
      bump(kept, k.name, 1)
      return MARK(spans.length - 1)
    })
  }
  return { out, spans }
}
const restore = (text: string, spans: string[]) => text.replace(/(\d+)/g, (_, i) => spans[Number(i)] ?? "")

const edits: { path: string; text: string }[] = []
for (const path of files) {
  const buf = readFileSync(join(ROOT, path))
  if (buf.includes(0)) continue
  const before = buf.toString("utf8")
  if (!/yuki/i.test(before)) continue
  const { out, spans } = stripKept(path, before)
  let text = out
  for (const rule of RULES) {
    text = text.replace(rule.re, (...m) => {
      bump(perRule, rule.name, 1)
      bump(perFile, path, 1)
      return typeof rule.to === "string" ? rule.to : rule.to(m[0])
    })
  }
  edits.push({ path, text: restore(text, spans) })
}

const renames = files.filter((p) => /yuki/i.test(p)).map((p) => ({ from: p, to: p.replace(/yuki/g, "kiko").replace(/Yuki/g, "Kiko") }))

console.log("rule counts")
for (const [k, v] of perRule) console.log(`  ${String(v).padStart(5)}  ${k}`)
console.log("kept literals")
for (const [k, v] of kept) console.log(`  ${String(v).padStart(5)}  ${k}`)
console.log(`files changed: ${edits.length}, paths renamed: ${renames.length}`)
if (DRY) {
  console.log("per file")
  for (const [k, v] of [...perFile].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`)
  for (const r of renames) console.log(`  mv ${r.from} -> ${r.to}`)
} else {
  for (const e of edits) writeFileSync(join(ROOT, e.path), e.text)
  for (const r of renames) {
    if (!existsSync(join(ROOT, r.from))) continue
    mkdirSync(dirname(join(ROOT, r.to)), { recursive: true })
    execFileSync("git", ["mv", r.from, r.to], { cwd: ROOT })
  }
}

const leftover: string[] = []
const after = DRY ? edits : files.map((p) => ({ path: renames.find((r) => r.from === p)?.to ?? p, text: "" }))
for (const e of DRY ? edits : after) {
  const text = DRY ? e.text : (() => { try { return readFileSync(join(ROOT, e.path), "utf8") } catch { return "" } })()
  text.split("\n").forEach((line, i) => {
    const rest = stripKept(e.path, line).out
    if (/yuki/i.test(rest)) leftover.push(`${e.path}:${i + 1}: ${line.trim().slice(0, 140)}`)
  })
}
if (leftover.length) {
  console.error(`${leftover.length} lines still mention yuki outside the allowlist`)
  console.error(leftover.slice(0, 50).join("\n"))
  process.exit(1)
}
console.log("allowlist check passed")
