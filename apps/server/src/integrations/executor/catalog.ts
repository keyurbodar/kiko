// What a user has connected in Executor, so an agent can call it on its first turn. Without this an
// agent spent most of a task finding its own apps: read the guides, search, describe, then call,
// one model turn each. One program run inside Executor lists every app's exact path, account ids,
// and tool signatures; the execute tool's description carries the result.
//
// Each app also gets a handle, a plain object the agent calls as `github.list_commits({ owner })`.
// `withHandles` defines the handles a program uses in one line before it. A handle fills in the
// account, wraps the fields in `input`, and returns the parsed result, which are the three things
// a model got wrong most when it called `tools.<slug>.profiles[...]` itself.
//
// Executor's own app, the one that adds apps and connects accounts, is a handle too, with every
// input listed: without them an agent probed shapes until one passed, 14 programs for one request.
//
// The apps Executor can add are 5,562 catalog entries and 2 MB, too slow to fetch and scan inside
// Executor's interpreter (10 s a search). Yuki keeps a compact index of them, read in pages by
// `INDEX_PROGRAM`, and `findApps` ranks it in place.

export type ExecutorAppTool = { name: string; input?: string }
export type ExecutorApp = { path: string; handle: string; accounts: string[]; tools: ExecutorAppTool[] }
export type ExecutorCatalog = { apps: ExecutorApp[]; unavailable: { name: string; reason: string }[] }

/** Executor's own management app. */
const MANAGEMENT = "tools.executor."

/** The management app, when the user's listing has it. */
export const managementApp = (catalog: ExecutorCatalog | undefined) => catalog?.apps.find((a) => a.path.startsWith(MANAGEMENT))

/**
 * A program that only names the user's apps. Executor loads every app a program names, and an app
 * it has not loaded for a while costs the next call 1.2 to 2.8 s, so a run sends this first.
 */
export function warmProgram(catalog: ExecutorCatalog): string {
  return `return [${catalog.apps.filter((a) => !a.path.startsWith(MANAGEMENT)).map((a) => `typeof ${a.path}`).join(", ")}].length`
}

/** Whether an app lists a tool. Every Executor tool yuki names is checked this way first. */
export const hasTool = (app: ExecutorApp | undefined, name: string) => Boolean(app?.tools.some((t) => t.name === name))

/** Whether a program names an app, by its handle or its path. */
export const usesApp = (code: string, app: ExecutorApp) => new RegExp(`(^|[^.\\w$])${app.handle}\\.`).test(code) || code.includes(app.path)
/** A longer signature is cut. The agent can still search for the full one. */
const SIGNATURE_CHARS = 400

/**
 * A tool's input as the agent writes it. An account tool takes `{ accountId, input }` and the
 * description names the account once per app, so only the `input` object is kept.
 */
export function compactSignature(signature: string): string {
  let sig = signature
  const at = sig.indexOf("input: {")
  if (/accountId: "/.test(sig) && at >= 0) {
    let depth = 0
    for (let i = at + 7; i < sig.length; i++) {
      if (sig[i] === "{") depth++
      else if (sig[i] === "}" && --depth === 0) {
        sig = sig.slice(at + 7, i + 1)
        break
      }
    }
  }
  return sig
    .replace(/contentType\?: "application\/json",?\s*/g, "")
    .replace(/organization\?: string(?: \| string)?,?\s*/g, "")
    .replace(/path\?: \{\s*\},?\s*/g, "")
    .replace(/\s*&\s*\(?\{\s*(?:path: \{[^{}]*\},?\s*)?body: unknown,?\s*\}\)?/g, "")
    .replace(/^\((\{[\s\S]*\})\)$/, "$1")
    .replace(/\s*&\s*\{\s*\[key: string\]: unknown\s*\}\s*$/, "")
    .replace(/,?\s*\[key: string\]: unknown\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\{\s+\}/g, "{}")
    .replace(/\s+\}/g, " }")
    .trim()
}

/** The program `UserDO` runs through `execute`. Search pages hold at most 50 items. */
export const DISCOVER_PROGRAM = `const compact = ${compactSignature.toString()};
const apps = {};
let offset = 0;
for (;;) {
  const r = await tools.search({ limit: 50, offset });
  for (const it of r.items) {
    const m = /^(tools\\.[A-Za-z0-9_$]+(?:\\.profiles\\["[^"]+"\\])?)\\.(.+)$/.exec(it.path);
    if (!m) continue;
    const a = apps[m[1]] || (apps[m[1]] = { path: m[1], accounts: [], tools: [] });
    const sig = String(it.input || "");
    const re = /accountId: "([^"]+)"/g;
    let x;
    while ((x = re.exec(sig))) if (a.accounts.indexOf(x[1]) < 0) a.accounts.push(x[1]);
    a.tools.push({ name: m[2], input: compact(sig).slice(0, ${SIGNATURE_CHARS}) });
  }
  if (!r.next) break;
  offset = r.next.offset;
}
return Object.values(apps);`

type Unavailable = { name?: unknown; reason?: unknown }

/** Reads the result of `DISCOVER_PROGRAM`. Null when it did not complete. */
export function parseCatalog(text: string): ExecutorCatalog | null {
  let body: { status?: unknown; execution?: { ok?: unknown; value?: unknown }; unavailableApps?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (body.status !== "completed" || body.execution?.ok !== true || !Array.isArray(body.execution.value)) return null
  const apps: ExecutorApp[] = []
  const taken = new Set<string>()
  for (const a of body.execution.value as Record<string, unknown>[]) {
    if (typeof a?.path !== "string" || !Array.isArray(a.tools)) continue
    apps.push({
      path: a.path,
      handle: handleName(a.path, taken),
      accounts: Array.isArray(a.accounts) ? a.accounts.filter((x): x is string => typeof x === "string") : [],
      tools: (a.tools as Record<string, unknown>[]).flatMap((t) =>
        typeof t?.name === "string" ? [typeof t.input === "string" && t.input ? { name: t.name, input: t.input } : { name: t.name }] : [],
      ),
    })
  }
  const unavailable = (Array.isArray(body.unavailableApps) ? (body.unavailableApps as Unavailable[]) : []).flatMap((u) =>
    typeof u?.name === "string" ? [{ name: u.name, reason: reasonText(u.reason) }] : [],
  )
  return { apps, unavailable }
}

/** Names that a handle must not shadow in the program. */
const RESERVED = new Set(["tools", "console", "JSON", "Math", "Object", "Array", "Promise", "String", "Number", "Date", "Error", "await", "return"])

/** A JavaScript name for an app, from its slug: `tools.google-calendar...` is `google_calendar`. */
function handleName(path: string, taken: Set<string>): string {
  const slug = /^tools\.([^.[]+)/.exec(path)?.[1] ?? "app"
  let base = slug.replace(/[^A-Za-z0-9_$]/g, "_")
  if (/^[0-9]/.test(base) || RESERVED.has(base)) base = `${base}_app`
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
  taken.add(name)
  return name
}

const HELPERS =
  'const __read = (r) => { if (r && Array.isArray(r.content)) { const t = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\\n"); if (r.isError) throw new Error(t); if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent; try { return JSON.parse(t); } catch (e) { return t; } } return r; }; ' +
  "const __app = (p, acc, names) => { const o = {}; for (const n of names) { const keys = n.split('.'); const last = keys.pop(); let at = o; for (const k of keys) at = at[k] || (at[k] = {}); at[last] = async (fields) => { let f = p; for (const k of keys) f = f[k]; return __read(await f[last](acc ? { accountId: acc, input: fields || {} } : fields || {})); }; } return o; }; "

/**
 * The program with the handles it uses defined first, on its own first line so error positions
 * still match. A handle the program never names is left out: Executor loads every app a program
 * mentions. A name the program declares itself is left alone.
 */
export function withHandles(code: string, catalog: ExecutorCatalog): string {
  const used = catalog.apps.filter((a) => new RegExp(`(^|[^.\\w$])${a.handle}\\.`).test(code) && !new RegExp(`\\b(const|let|var|function)\\s+${a.handle}\\b`).test(code))
  if (!used.length) return code
  const defs = used.map((a) => `const ${a.handle} = __app(${a.path}, ${JSON.stringify(a.accounts[0] ?? "")}, ${JSON.stringify(a.tools.map((t) => t.name))}); `).join("")
  return `${HELPERS}${defs}${code}`
}

/** Executor sends a reason as plain text or as JSON with a message. */
function reasonText(reason: unknown): string {
  const raw = typeof reason === "string" ? reason : ""
  try {
    const parsed = JSON.parse(raw) as { message?: unknown }
    if (typeof parsed.message === "string") return parsed.message
  } catch {}
  return raw.slice(0, 200)
}

/** The execute tool's description when the catalog is known. */
export function describeExecute(catalog: ExecutorCatalog): string {
  const lines = [
    "Run a JavaScript program over the human's connected apps in Executor. Each app below is a ready object in every program: call await <app>.<tool>({ ...fields }) and get the parsed result. The account is filled in for you. Everything you need is here: there are no guides to read.",
    "",
  ]
  for (const app of catalog.apps) {
    if (app.path.startsWith(MANAGEMENT)) continue
    const others = app.accounts.length > 1 ? ` It uses account "${app.accounts[0]}"; for another (${app.accounts.slice(1).join(", ")}), call ${app.path}.<tool>({ accountId, input: { ...fields } }) instead.` : ""
    lines.push(`${app.handle}: for example await ${app.handle}.${app.tools[0]?.name ?? "<tool>"}({ ... }).${others} Tools and their fields:`)
    for (const t of app.tools) lines.push(`  ${t.name}${t.input ? ` ${t.input}` : ""}`)
  }
  for (const u of catalog.unavailable) lines.push(`${u.name}: not usable yet (${u.reason}). Connect its account and give the human the link.`)
  const manage = catalog.apps.find((a) => a.path.startsWith(MANAGEMENT))
  if (manage) {
    lines.push("", `${manage.handle}: Executor itself, for adding apps and connecting accounts. Tools and their arguments, passed as they are:`)
    for (const t of manage.tools) lines.push(`  ${t.name}${t.input ? ` ${t.input}` : ""}`)
    if (hasTool(manage, "organization.catalog")) lines.push("To find an app to add, call the executor_find_apps tool, never a catalog tool: it answers at once.")
    if (hasTool(manage, "apps.install")) lines.push("An entry from executor_find_apps goes to apps.install({ body: { entry, name } }).")
    if (hasTool(manage, "apps.importCustom")) lines.push('Any other MCP server URL goes to apps.importCustom({ body: { source: { kind: "mcp", name, url } } }).')
    if (hasTool(manage, "profiles.create") && hasTool(manage, "accounts.connect")) {
      lines.push("To connect an account: profiles.create({ path: { app }, body: { accounts: {}, idempotencyKey } }), then accounts.connect({ path: { app }, body: { profile, requirement } }) returns a url for the human.")
    }
  }
  lines.push(
    "",
    "How to work:",
    "- Do the whole task in one program: run independent calls with Promise.all, and chain dependent ones (find the item, then fetch what you need from it) in the same program.",
    "- Read results in code and return a small summary. Never return raw data only to see its shape; read fields defensively instead.",
    "- Use tools.search({ query, namespace }) only for a tool that is not listed here, or when a call's error says the input is wrong.",
    "- No imports, fetch, process, or filesystem. Never ask the human for a secret: for a credential, get a link from accounts.connect and give it to them.",
    "- If the result is approval-required or input-required, tell the human what it does and wait; then call resume with its requestId. Never run the program again to continue it. External effects are not rolled back.",
  )
  return lines.join("\n")
}

/**
 * One catalog entry: id (what `apps.install` takes), name, kind, domain, the start of its
 * description, curated, popularity, and the description's distinct words for search.
 */
export type CatalogRow = [string, string, string, string, string, number, number, string]

/** Entries per page. A row is about 280 characters, and an execute returns at most 64 KB. */
export const INDEX_PAGE = 180
/** Words of a description kept for search, after common ones are dropped. */
const KEYWORDS = 24

/** Reads one page of Executor's catalog of apps it can add, through the management app at `path`. */
export function indexProgram(path: string, offset: number): string {
  return `const cat = await ${path}.organization.catalog({});
const common = ${JSON.stringify(COMMON)};
const keywords = (text) => { const seen = []; for (const w of String(text || "").toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 2 && common.indexOf(w) < 0 && seen.indexOf(w) < 0 && seen.length < ${KEYWORDS}) seen.push(w); return seen.join(" "); };
const rows = cat.slice(${offset}, ${offset + INDEX_PAGE}).map((c) => [String(c.id), String(c.name || ""), String(c.kind || ""), String(c.domain || ""), String(c.description || "").slice(0, 60), (c.feeds || []).indexOf("curated") >= 0 ? 1 : 0, c.popularity || 0, keywords(c.description)]);
if (JSON.stringify(rows).length > 60000) for (const r of rows) r[7] = r[7].split(" ").slice(0, 8).join(" ");
return { total: cat.length, rows };`
}

/** Reads the result of `indexProgram`. Null when it did not complete. */
export function parseIndexPage(text: string): { total: number; rows: CatalogRow[] } | null {
  try {
    const body = JSON.parse(text) as { status?: unknown; execution?: { ok?: unknown; value?: { total?: unknown; rows?: unknown } } }
    const value = body.execution?.value
    if (body.status !== "completed" || body.execution?.ok !== true || typeof value?.total !== "number" || !Array.isArray(value.rows)) return null
    return { total: value.total, rows: value.rows.filter((r): r is CatalogRow => Array.isArray(r) && r.length === 8 && typeof r[0] === "string") }
  } catch {
    return null
  }
}

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)

/** Words too common in app descriptions to tell apps apart. */
const COMMON = ["the", "and", "for", "with", "your", "you", "that", "this", "from", "are", "its", "can", "into", "via", "api", "mcp", "server", "app", "apps", "tools", "tool", "agents", "agent", "hosted", "lets", "gives", "use", "using", "access", "data", "connect", "official"]

/**
 * The best catalog entries for a query. An entry that matches more of the query's words comes
 * first; then a word in its name counts more than in its domain, more than in its description;
 * then curated and popular entries. An entry no word matches is never returned.
 */
export function findApps(rows: readonly CatalogRow[], query: string, limit = 8): { entry: string; name: string; kind: string; domain: string; about: string }[] {
  const want = [...new Set(words(query))]
  if (!want.length) return []
  const scored: { s: number; row: CatalogRow }[] = []
  for (const row of rows) {
    const [, name, , domain, about, curated, popularity, keywords] = row
    const n = new Set(words(name))
    const d = new Set(words(domain))
    const a = new Set([...words(about), ...words(keywords)])
    let matched = 0
    let s = 0
    for (const w of want) {
      const best = n.has(w) ? 4 : d.has(w) ? 2 : a.has(w) ? 1 : 0
      if (best) matched++
      s += best
    }
    if (matched) scored.push({ s: matched * 10 + s + curated * 5 + Math.log10(popularity + 1) / 2, row })
  }
  return scored
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map(({ row: [entry, name, kind, domain, about] }) => ({ entry, name, kind, domain, about }))
}
