import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import type {
  Apps,
  AppSummary,
  CallResult,
  ClaimLink,
  DeployOutcome,
  Diagnostic,
  InspectWhat,
} from "../../apps/service"
import type { RoomFs } from "../../files/room-fs"

const APPS = "apps"

const MAX_FILE_BYTES = 256_000
const MAX_TOTAL_BYTES = 900_000
const MAX_BODY_BYTES = 4_000_000
const SHOWN_CHARS = 8_000
const SOURCE = /\.(tsx?|jsx?|mjs|css|json|svg|md|txt)$/

const text = (t: string) => [{ type: "text" as const, text: t }]
const clip = (t: string) =>
  t.length > SHOWN_CHARS ? `${t.slice(0, SHOWN_CHARS)}… (cut; pass save_to for all of it)` : t
const appDir = (name: string) => `/home/apps/${name}`
const shown = (value: unknown) => clip(typeof value === "string" ? value : JSON.stringify(value, null, 1))

const LISTED_DEPLOYS = 30

function accountLines(deploys: unknown, known: ReadonlySet<string>): string[] {
  const body = deploys as { deploys?: unknown } | null
  const items: unknown[] = Array.isArray(deploys) ? deploys : Array.isArray(body?.deploys) ? body.deploys : []
  const lines = items.flatMap((item) => {
    const fields = (item ?? {}) as Record<string, unknown>
    const url = typeof fields.url === "string" ? fields.url : ""
    if (!url || known.has(url)) return []
    const name = [fields.name, fields.title, fields.deployId, fields.id].find((v) => typeof v === "string") ?? "?"
    return [`${name}: ${url}`]
  })
  return lines.length > LISTED_DEPLOYS
    ? [...lines.slice(0, LISTED_DEPLOYS), `and ${lines.length - LISTED_DEPLOYS} more`]
    : lines
}

export type AppsDeps = { apps: () => Apps | null; fs: RoomFs }

async function sources(fs: RoomFs, name: string): Promise<Record<string, string>> {
  const listed = await fs.list(appDir(name), true)
  if (!listed.ok) throw new Error(`No source at ${appDir(name)}: ${listed.error.message}`)
  const marker = `apps/${name}/`
  const files: Record<string, string> = {}
  let total = 0
  for (const entry of listed.value) {
    if (entry.kind !== "file") continue
    const rel = entry.path.slice(entry.path.indexOf(marker) + marker.length)
    if (rel.startsWith(".") || rel.includes("/.") || !SOURCE.test(rel)) continue
    if (entry.size > MAX_FILE_BYTES) throw new Error(`${rel} is over ${MAX_FILE_BYTES} bytes.`)
    total += entry.size
    if (total > MAX_TOTAL_BYTES) throw new Error(`The app source is over ${MAX_TOTAL_BYTES} bytes.`)
    const bytes = await fs.bytesOf(entry)
    if (!bytes) throw new Error(`Could not read ${rel}.`)
    files[rel] = new TextDecoder().decode(bytes)
  }
  if (!files["server/index.ts"]) throw new Error(`Missing ${appDir(name)}/server/index.ts.`)
  return files
}

async function readBody(fs: RoomFs, path: string): Promise<Uint8Array> {
  const read = await fs.readBinaryFile(path)
  if (!read.ok) throw new Error(read.error.message)
  if (read.value.length > MAX_BODY_BYTES) throw new Error(`${path} is over ${MAX_BODY_BYTES} bytes.`)
  return read.value
}

async function saveTo(fs: RoomFs, path: string, bytes: Uint8Array): Promise<string> {
  const written = await fs.writeFile(path, bytes)
  if (!written.ok) throw new Error(written.error.message)
  return `saved ${bytes.length} bytes to ${path}`
}

const where = (d: Diagnostic) => [d.file ?? d.path, d.line].filter((x) => x !== undefined).join(":")

export const appLine = (a: AppSummary) =>
  `${a.name}: ${a.url} ${
    a.claimed
      ? "(owned)"
      : a.expired
        ? "(expired and no longer live: deploy it again, or send the human a claim link with app_manage claim_link)"
        : `(expires ${a.expiresAt ?? "?"})`
  }`

const claimText = (claim: ClaimLink) => `${claim.url} (verification code ${claim.code})`

const HOUR_MS = 3_600_000
const REMIND_BEFORE_MS = 48 * HOUR_MS

function remindAt(expiresAt: string | null, now: number): string | null {
  const expires = expiresAt ? Date.parse(expiresAt) : Number.NaN
  if (!Number.isFinite(expires) || expires - now < 2 * HOUR_MS) return null
  const at = expires - REMIND_BEFORE_MS > now + HOUR_MS ? expires - REMIND_BEFORE_MS : now + (expires - now) / 2
  return new Date(at).toISOString()
}

function claimAsk(out: { app: { expiresAt: string | null }; claim: ClaimLink }, now: number): string {
  const at = remindAt(out.app.expiresAt, now)
  return [
    `Give the human this claim link with the app url: ${claimText(out.claim)}.`,
    "One click keeps this app forever and connects their Lakebed account, so every app after it is owned automatically. They can also do it from Settings, Web apps.",
    at
      ? `Then make one one-time routine for yourself at ${at} that runs app_list and, if this app is still not owned, sends the human its claim link again from app_manage claim_link.`
      : "",
  ]
    .filter(Boolean)
    .join(" ")
}

function liveLine(status: number | null | undefined): string {
  if (status === undefined) return ""
  if (status === null)
    return "\nthe url did not answer yet. do not poll it; look at app_inspect logs once if the human reports a problem."
  if (status < 400) return `\nlive (${status})`
  return `\nthe url answered ${status} right after the deploy. read app_inspect logs once to find out why; do not poll it with sleep.`
}

export function deployReport(out: DeployOutcome, now = Date.now()): string {
  if (out.ok) {
    const expiry = out.app.claimed ? "owned, never expires" : `unclaimed, expires ${out.app.expiresAt ?? "soon"}`
    const line = `${out.changed ? "deployed" : "unchanged, already live"}: ${out.app.url} (${expiry})${liveLine(out.live)}`
    return out.claim ? `${line}\n${claimAsk({ app: out.app, claim: out.claim }, now)}` : line
  }
  if ("error" in out) return `not deployed: ${out.error}`
  return `build failed, fix these and deploy again:\n${out.diagnostics.map((d) => `${where(d)} ${d.message}`).join("\n")}`
}

const MANAGE_ACTIONS = [
  "env_list",
  "env_set",
  "env_unset",
  "domain_add",
  "domain_status",
  "domain_list",
  "domain_remove",
  "users_list",
  "user_approve",
  "user_deny",
  "user_remove",
  "storage_get",
  "storage_delete",
  "archive",
  "restore",
  "terminate",
  "claim_link",
  "forget",
] as const
type ManageAction = (typeof MANAGE_ACTIONS)[number]
type ManageArgs = {
  name: string
  action: ManageAction
  key?: string
  value?: string
  hostname?: string
  subject?: string
  save_to?: string
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new Error(`This action needs ${what}.`)
  return value
}

async function stored(fs: RoomFs, out: CallResult, path: string | undefined): Promise<string> {
  if (out.status >= 400) return `${out.status}\n${clip(out.body || new TextDecoder().decode(out.bytes))}`
  if (path) return saveTo(fs, path, out.bytes)
  return out.type.startsWith("text/") || out.type.includes("json")
    ? clip(new TextDecoder().decode(out.bytes))
    : `${out.bytes.length} bytes of ${out.type}; pass save_to to keep it`
}

async function manage(apps: Apps, fs: RoomFs, a: ManageArgs): Promise<string> {
  switch (a.action) {
    case "env_list":
      return `env keys: ${(await apps.env(a.name, {}, [])).join(", ") || "none"}`
    case "env_set":
      return `env keys: ${(await apps.env(a.name, { [need(a.key, "key")]: a.value ?? "" }, [])).join(", ")}. Deploy to apply.`
    case "env_unset":
      return `env keys: ${(await apps.env(a.name, {}, [need(a.key, "key")])).join(", ") || "none"}. Deploy to apply.`
    case "domain_add":
    case "domain_status":
    case "domain_remove":
      return shown(await apps.domains(a.name, a.action.slice(7) as "add", need(a.hostname, "hostname")))
    case "domain_list":
      return shown(await apps.domains(a.name, "list"))
    case "users_list":
      return shown(await apps.users(a.name, "list"))
    case "user_approve":
    case "user_deny":
    case "user_remove":
      return shown(await apps.users(a.name, a.action.slice(5) as "approve", need(a.subject, "subject")))
    case "storage_get":
      return stored(fs, await apps.storageGet(a.name, need(a.key, "key")), a.save_to)
    case "storage_delete":
      return shown(await apps.storageDelete(a.name, need(a.key, "key")))
    case "archive":
    case "restore":
    case "terminate":
      return shown(await apps.lifecycle(a.name, a.action))
    case "claim_link":
      return `Give the human this link. Claiming makes the app permanent and connects their Lakebed account to Kiko: ${claimText(await apps.claimLink(a.name))}`
    case "forget":
      return apps.forget(a.name) ? `Kiko forgot ${a.name}. The deploy itself is untouched.` : `No app named ${a.name}.`
  }
}

export function appsExtension(deps: AppsDeps): Extension {
  const apps = () => {
    const service = deps.apps()
    if (!service)
      throw new Error(
        "Kiko is installing the app builder on this install. Tell the human and end your turn; check once after they reply.",
      )
    return service
  }
  const guarded =
    <A>(run: (args: A) => Promise<string | { text: string; isError: boolean }>) =>
    async (args: A) => {
      try {
        const answer = await run(args)
        if (typeof answer === "string") return { output: text(answer) }
        return { output: text(answer.text), ...(answer.isError ? { isError: true } : {}) }
      } catch (e) {
        return { output: text(e instanceof Error ? e.message : String(e)), isError: true }
      }
    }
  return defineExtension({
    name: APPS,
    tools: [
      declareEffect(
        "external",
        defineTool({
          name: "app_deploy",
          description:
            "Build the Lakebed app in /home/apps/<name>/ and deploy it live. Read /kiko/apps.md first. Returns the url, or the build errors to fix. Deploying unchanged source is free.",
          parameters: Type.Object({
            name: Type.String({ description: "folder name under /home/apps" }),
            public_inspect: Type.Optional(
              Type.Boolean({ description: "let anyone with the url read the app's data and logs" }),
            ),
            delete_tables: Type.Optional(
              Type.Array(Type.Object({ table: Type.String(), row_count: Type.Number() }), {
                description: "confirm dropping these tables and their exact row counts when the schema removes them",
              }),
            ),
          }),
          replay: "unsafe",
          execute: guarded(
            async (args: {
              name: string
              public_inspect?: boolean
              delete_tables?: { table: string; row_count: number }[]
            }) => {
              const out = await apps().deploy(args.name, await sources(deps.fs, args.name), {
                ...(args.public_inspect ? { publicInspect: true } : {}),
                ...(args.delete_tables?.length
                  ? { deleteTables: args.delete_tables.map((t) => ({ table: t.table, rowCount: t.row_count })) }
                  : {}),
              })
              return { text: deployReport(out), isError: !out.ok }
            },
          ),
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "app_list",
          description: "List your apps with their urls and expiry, and every deploy on the human's Lakebed account.",
          parameters: Type.Object({}),
          replay: "safe",
          execute: guarded(async () => {
            const { apps: mine, deploys } = await apps().inventory()
            const lines = mine.map(appLine)
            const others = accountLines(deploys, new Set(mine.map((a) => a.url)))
            return [
              lines.join("\n") || "no apps yet",
              others.length ? `also on the human's Lakebed account:\n${others.join("\n")}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          }),
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "app_inspect",
          description:
            "Read a deployed app: logs (server logs and errors), tables, db (every row), manifest (its queries, mutations, endpoints and tools; with query it runs that query), usage (requests, writes and storage against the limits), storage (uploaded files), export (one page of a table backup).",
          parameters: Type.Object({
            name: Type.String(),
            what: Type.Union(
              (["logs", "tables", "db", "manifest", "usage", "storage", "export"] as const).map((w) => Type.Literal(w)),
            ),
            query: Type.Optional(Type.String({ description: "manifest: a query name to run" })),
            table: Type.Optional(Type.String({ description: "export: the table" })),
            cursor: Type.Optional(Type.String({ description: "export: the cursor from the previous page" })),
            prefix: Type.Optional(Type.String({ description: "storage: only keys with this prefix" })),
            save_to: Type.Optional(Type.String({ description: "write the full answer to this file instead" })),
          }),
          replay: "safe",
          execute: guarded(
            async (args: {
              name: string
              what: InspectWhat
              query?: string
              table?: string
              cursor?: string
              prefix?: string
              save_to?: string
            }) => {
              const params: Record<string, string> = {}
              if (args.query) params.query = args.query
              if (args.table) params.table = args.table
              if (args.cursor) params.cursor = args.cursor
              if (args.prefix) params.prefix = args.prefix
              const answer = await apps().inspect(args.name, args.what, params)
              return args.save_to ? saveTo(deps.fs, args.save_to, new TextEncoder().encode(answer)) : clip(answer)
            },
          ),
        }),
      ),
      declareEffect(
        "external",
        defineTool({
          name: "app_call",
          description:
            "Send an HTTP request to one of your apps, signed so isKiko(req) is true. Push data into an endpoint or check a route. Pass body_file to send a file you made with bash, so big data never goes through you.",
          parameters: Type.Object({
            name: Type.String(),
            method: Type.Union([
              Type.Literal("GET"),
              Type.Literal("POST"),
              Type.Literal("PUT"),
              Type.Literal("DELETE"),
            ]),
            path: Type.String({ description: "path on the app, like /ingest" }),
            body: Type.Optional(Type.String({ description: "JSON body" })),
            body_file: Type.Optional(Type.String({ description: "send this file as the body instead" })),
            content_type: Type.Optional(Type.String({ description: "defaults to application/json" })),
            save_to: Type.Optional(Type.String({ description: "write the response body to this file" })),
          }),
          replay: "unsafe",
          execute: guarded(
            async (args: {
              name: string
              method: string
              path: string
              body?: string
              body_file?: string
              content_type?: string
              save_to?: string
            }) => {
              const body = args.body_file ? await readBody(deps.fs, args.body_file) : args.body
              const out = await apps().call(args.name, args.method, args.path, body, args.content_type)
              if (args.save_to) return `${out.status}\n${await saveTo(deps.fs, args.save_to, out.bytes)}`
              return `${out.status}\n${clip(out.body)}`
            },
          ),
        }),
      ),
      declareEffect(
        "external",
        defineTool({
          name: "app_manage",
          description:
            "Run everything else Lakebed offers on an app: env_list, env_set {key, value}, env_unset {key} (server secrets for ctx.env; owned apps only; deploy to apply), domain_add/domain_status/domain_remove {hostname}, domain_list, users_list, user_approve/user_deny/user_remove {subject}, storage_get {key, save_to?}, storage_delete {key}, archive, restore, terminate, claim_link (only for the human), forget (Kiko drops the app, the deploy stays).",
          parameters: Type.Object({
            name: Type.String(),
            action: Type.Union(MANAGE_ACTIONS.map((a) => Type.Literal(a))),
            key: Type.Optional(Type.String()),
            value: Type.Optional(Type.String()),
            hostname: Type.Optional(Type.String()),
            subject: Type.Optional(Type.String({ description: "a user id or email" })),
            save_to: Type.Optional(Type.String()),
          }),
          replay: "unsafe",
          execute: guarded((args: ManageArgs) => manage(apps(), deps.fs, args)),
        }),
      ),
      declareEffect(
        "external",
        defineTool({
          name: "lakebed_account",
          description:
            "Connect the human's Lakebed account so new apps are owned: they never expire and can use server fetch and env. connect returns a link and code for the human to approve; status checks it; disconnect forgets it.",
          parameters: Type.Object({
            action: Type.Union([Type.Literal("connect"), Type.Literal("status"), Type.Literal("disconnect")]),
          }),
          replay: "unsafe",
          execute: guarded(async (args: { action: "connect" | "status" | "disconnect" }) => {
            const service = apps()
            if (args.action === "disconnect") {
              service.disconnect()
              return "Kiko forgot the Lakebed account."
            }
            const status = args.action === "connect" ? await service.connect() : await service.status()
            if (status.state === "connected") return `connected${status.login ? ` as ${status.login}` : ""}`
            if (status.state === "waiting")
              return `waiting for the human: they open ${status.url} and approve code ${status.code}. tell the human and end your turn; check status once after they reply.`
            return "not connected"
          }),
        }),
      ),
    ],
  })
}
