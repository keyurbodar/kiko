import { gzipSync } from "node:zlib"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const DIST = join(import.meta.dir, "../apps/web-solid/dist")
const TOLERANCE = 1.05
const HTML_MAX_BYTES = 20 * 1024

const FIRST_PAINT_ROUTE = "src/app/routes/chat.tsx"
const APP_ENTRY = "src/main.tsx"

const TIER3 = [
  "src/palette/palette.tsx",
  "src/chat/side/Sidecar.tsx",
  "src/chat/ui/DateCalendar.tsx",
  "../../packages/ui/src/v2/components/overlays-impl.ts",
  "../../packages/ui/src/v2/components/toast-v2-impl.tsx",
  "src/composer/prompt-input/extras.tsx",
  "src/composer/rich/bind.ts",
  "src/chat/ui/ImageDialog.tsx",
  "src/chat/ui/EmojiPicker.tsx",
  "src/chat/ui/ReactionPopover.tsx",
  "src/chat/ui/SuspiciousLinkDialog.tsx",
]
const TIER4 = ["src/settings/settings-dialog.tsx"]

const RECORDED: Record<string, number> = {
  "tier 1 shell js": 2358,
  "tier 2 first paint of /chat": 214055,
  "tier 3 lazy modules": 313960,
  "tier 4 route chunks": 27858,
}

interface Entry {
  file: string
  imports?: string[]
  css?: string[]
  isEntry?: boolean
}

const manifestPath = join(DIST, ".vite/manifest.json")
if (!existsSync(manifestPath)) {
  console.error("no build manifest. run `bun run build` in apps/web-solid first.")
  process.exit(1)
}
const manifest: Record<string, Entry> = JSON.parse(readFileSync(manifestPath, "utf8"))

const gz = (file: string): number => gzipSync(readFileSync(join(DIST, file))).length

const missing = new Set<string>()

function closure(keys: string[], exclude = new Set<string>()): Set<string> {
  const files = new Set<string>()
  const seen = new Set<string>()
  const visit = (key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    const entry = manifest[key]
    if (!entry) {
      missing.add(key)
      return
    }
    if (!exclude.has(entry.file)) files.add(entry.file)
    for (const css of entry.css ?? []) if (!exclude.has(css)) files.add(css)
    for (const dep of entry.imports ?? []) visit(dep)
  }
  keys.forEach(visit)
  return files
}

const size = (files: Iterable<string>) => [...files].reduce((sum, file) => sum + gz(file), 0)

const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry)
if (!entryKey) throw new Error("manifest has no entry")

const tier1 = closure([entryKey])
const tier2 = closure([APP_ENTRY, FIRST_PAINT_ROUTE], tier1)
const tier3 = closure(TIER3, new Set([...tier1, ...tier2]))
const tier4 = closure(TIER4, new Set([...tier1, ...tier2, ...tier3]))

const measured: Record<string, number> = {
  "tier 1 shell js": size(tier1),
  "tier 2 first paint of /chat": size(tier2),
  "tier 3 lazy modules": size(tier3),
  "tier 4 route chunks": size(tier4),
}

const BANNED: Record<string, RegExp> = {
  effect: /["'`]effect\/[A-Z]/,
  codemirror: /@codemirror|cm-editor|cm-content/,
  "markdown parser (marked)": /markedjs\/marked/,
}

let failed = false
const rows: string[] = []
const fail = (message: string) => {
  failed = true
  console.error(`FAIL ${message}`)
}

const banned: Array<[string, Set<string>]> = [
  ["tier 1 shell js", tier1],
  ["tier 2 first paint of /chat", tier2],
  ["tier 3 lazy modules", tier3],
]
for (const [name, files] of banned) {
  for (const file of files) {
    if (!file.endsWith(".js")) continue
    const text = readFileSync(join(DIST, file), "utf8")
    for (const [lib, pattern] of Object.entries(BANNED)) {
      if (pattern.test(text))
        fail(`${name} contains ${lib} in ${file} (${gz(file)} bytes gzip). ${lib} may not load before tier 4.`)
    }
  }
}

for (const key of missing)
  fail(
    `manifest has no ${key}. A tier names it, so the tier is measured without it. Fix the key in scripts/bundle-budget.ts.`,
  )

const htmlBytes = readFileSync(join(DIST, "index.html")).length
const htmlOk = htmlBytes <= HTML_MAX_BYTES
if (!htmlOk) fail(`shell index.html is ${htmlBytes} bytes raw, over the ${HTML_MAX_BYTES} byte max`)
console.log(`${htmlOk ? "ok  " : "FAIL"} index.html ${htmlBytes} bytes raw (max ${HTML_MAX_BYTES})`)
rows.push(`| shell index.html (raw) | ${htmlBytes} | ${HTML_MAX_BYTES} | ${htmlOk ? "ok" : "FAIL"} |`)

for (const [name, bytes] of Object.entries(measured)) {
  const recorded = RECORDED[name] ?? 0
  const limit = Math.floor(recorded * TOLERANCE)
  const ok = bytes <= limit
  if (!ok)
    fail(
      `${name} is ${bytes} bytes gzip, over its limit of ${limit} (recorded ${recorded} plus 5 percent). Fix the growth, or edit RECORDED in scripts/bundle-budget.ts and say why.`,
    )
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${bytes} bytes gzip (recorded ${recorded}, limit ${limit})`)
  rows.push(`| ${name} | ${bytes} | ${limit} | ${ok ? "ok" : "FAIL"} |`)
}

const summary = process.env.GITHUB_STEP_SUMMARY
if (summary) {
  appendFileSync(
    summary,
    `### client bundle budget\n\n| tier | bytes | limit | result |\n| --- | ---: | ---: | --- |\n${rows.join("\n")}\n`,
  )
}

process.exit(failed ? 1 : 0)
