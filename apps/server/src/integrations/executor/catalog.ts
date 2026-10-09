// What a user has connected in Executor, so an agent can call it on its first turn. Without this an
// agent spent most of a task finding its own apps: read the guides, search, describe, then call,
// one model turn each. One program run inside Executor lists every app's exact path, account ids,
// and tool signatures; the execute tool's description carries the result.

export type ExecutorAppTool = { name: string; input?: string }
export type ExecutorApp = { path: string; accounts: string[]; tools: ExecutorAppTool[] }
export type ExecutorCatalog = { apps: ExecutorApp[]; unavailable: { name: string; reason: string }[] }

/** Executor's own management app. Its tools are many and rarely needed, so it is listed by name only. */
const MANAGEMENT = "tools.executor."
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
    const manage = m[1].indexOf(${JSON.stringify(MANAGEMENT)}) === 0;
    a.tools.push(manage ? { name: m[2] } : { name: m[2], input: compact(sig).slice(0, ${SIGNATURE_CHARS}) });
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
  for (const a of body.execution.value as Record<string, unknown>[]) {
    if (typeof a?.path !== "string" || !Array.isArray(a.tools)) continue
    apps.push({
      path: a.path,
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
    "Run a JavaScript program over the human's connected apps in Executor. The apps below are already discovered: their paths and account ids are exact, so call them directly.",
    "",
  ]
  for (const app of catalog.apps) {
    if (app.path.startsWith(MANAGEMENT)) continue
    const account = app.accounts.length === 1 ? `accountId: "${app.accounts[0]}", ` : app.accounts.length > 1 ? `accountId: one of ${app.accounts.map((a) => `"${a}"`).join(", ")}, ` : ""
    lines.push(account ? `${app.path}.<tool>({ ${account}input })` : `${app.path}.<tool>(input)`)
    for (const t of app.tools) lines.push(`  ${t.name}${t.input ? ` ${t.input}` : ""}`)
  }
  for (const u of catalog.unavailable) lines.push(`${u.name}: not usable yet (${u.reason}). Connect its account with Executor's accounts.connect and give the human the link.`)
  const manage = catalog.apps.find((a) => a.path.startsWith(MANAGEMENT))
  if (manage) lines.push("", `Executor's own app, for adding apps and connecting accounts: ${manage.path}.<tool>({ path, query, body }). Tools: ${manage.tools.map((t) => t.name).join(", ")}.`)
  lines.push(
    "",
    "How to work:",
    "- Do the whole task in one program when you can: call the tools above directly, run independent calls with Promise.all, and return only the fields you need.",
    "- A tool from an imported MCP server returns { content: [{ type: \"text\", text }], structuredContent? }. Read structuredContent when present, else JSON.parse the text when it is JSON.",
    "- Do not search or read skills for an app listed above. Use tools.search({ query, namespace }) only for an app or tool that is not listed, or when a call's error says the input is wrong.",
    "- No imports, fetch, process, or filesystem. Never ask the human for a secret: for a credential, get a link from accounts.connect and give it to them.",
    "- If the result is approval-required or input-required, tell the human what it does and wait; then call resume with its requestId. Never run the program again to continue it. External effects are not rolled back.",
  )
  return lines.join("\n")
}
