import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import type { Apps, DeployOutcome, Diagnostic } from "../../apps/service"
import type { RoomFs } from "../../files/room-fs"

const APPS = "apps"

const MAX_FILE_BYTES = 256_000
const MAX_TOTAL_BYTES = 900_000
const INSPECT_CHARS = 8_000
const SOURCE = /\.(tsx?|jsx?|css|json|svg|md)$/

const text = (t: string) => [{ type: "text" as const, text: t }]
const clip = (t: string) => (t.length > INSPECT_CHARS ? `${t.slice(0, INSPECT_CHARS)}…` : t)
const appDir = (name: string) => `/home/apps/${name}`

export type AppsDeps = { apps: () => Apps | null; fs: RoomFs }

async function sources(fs: RoomFs, name: string): Promise<Record<string, string> | string> {
  const listed = await fs.list(appDir(name), true)
  if (!listed.ok) return `no source at ${appDir(name)}: ${listed.error.message}`
  const marker = `apps/${name}/`
  const files: Record<string, string> = {}
  let total = 0
  for (const entry of listed.value) {
    if (entry.kind !== "file") continue
    const rel = entry.path.slice(entry.path.indexOf(marker) + marker.length)
    if (rel.startsWith(".") || rel.includes("/.") || !SOURCE.test(rel)) continue
    if (entry.size > MAX_FILE_BYTES) return `${rel} is over ${MAX_FILE_BYTES} bytes`
    total += entry.size
    if (total > MAX_TOTAL_BYTES) return `the app source is over ${MAX_TOTAL_BYTES} bytes`
    const bytes = await fs.bytesOf(entry)
    if (!bytes) return `could not read ${rel}`
    files[rel] = new TextDecoder().decode(bytes)
  }
  if (!files["server/index.ts"]) return `missing ${appDir(name)}/server/index.ts`
  return files
}

const where = (d: Diagnostic) => [d.file ?? d.path, d.line].filter((x) => x !== undefined).join(":")

function deployReport(out: DeployOutcome): string {
  if (out.ok) {
    const expiry = out.app.claimed ? "claimed, never expires" : `expires ${out.app.expiresAt ?? "soon"} unless claimed`
    return `${out.changed ? "deployed" : "unchanged, already live"}: ${out.app.url} (${expiry})`
  }
  if ("error" in out) return `deploy failed: ${out.error}`
  return `build failed, fix these and deploy again:\n${out.diagnostics.map((d) => `${where(d)} ${d.message}`).join("\n")}`
}

export function appsExtension(deps: AppsDeps): Extension {
  const apps = () => {
    const service = deps.apps()
    if (!service) throw new Error("app building is not set up on this install")
    return service
  }
  const guarded =
    <A>(run: (args: A) => Promise<string>) =>
    async (args: A) => {
      try {
        return { output: text(await run(args)) }
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
          parameters: Type.Object({ name: Type.String({ description: "folder name under /home/apps" }) }),
          replay: "unsafe",
          execute: guarded(async (args: { name: string }) => {
            const files = await sources(deps.fs, args.name)
            if (typeof files === "string") throw new Error(files)
            const out = await apps().deploy(args.name, files)
            return deployReport(out)
          }),
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "app_list",
          description: "List your deployed apps with their urls and expiry.",
          parameters: Type.Object({}),
          replay: "safe",
          execute: guarded(async () => {
            const all = apps().list()
            if (!all.length) return "no apps yet"
            return all
              .map((a) => `${a.name}: ${a.url} ${a.claimed ? "(claimed)" : `(expires ${a.expiresAt ?? "?"})`}`)
              .join("\n")
          }),
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "app_logs",
          description: "Read a deployed app's recent server logs and errors.",
          parameters: Type.Object({ name: Type.String() }),
          replay: "safe",
          execute: guarded(async (args: { name: string }) => clip(await apps().logs(args.name))),
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "app_db",
          description: "Read a deployed app's database tables and rows.",
          parameters: Type.Object({ name: Type.String() }),
          replay: "safe",
          execute: guarded(async (args: { name: string }) => clip(await apps().db(args.name))),
        }),
      ),
      declareEffect(
        "external",
        defineTool({
          name: "app_call",
          description:
            "Send an HTTP request to one of your apps, signed so isKiko(req) is true. Use it to push data into an app's endpoint or to check a route.",
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
          }),
          replay: "unsafe",
          execute: guarded(async (args: { name: string; method: string; path: string; body?: string }) => {
            const out = await apps().call(args.name, args.method, args.path, args.body)
            return `${out.status}\n${out.body}`
          }),
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "app_claim_link",
          description:
            "Get the link the human opens to claim an app on Lakebed, so it never expires and can use fetch and env. Only give it to the human.",
          parameters: Type.Object({ name: Type.String() }),
          replay: "safe",
          execute: guarded(async (args: { name: string }) => apps().claimLink(args.name)),
        }),
      ),
    ],
  })
}
