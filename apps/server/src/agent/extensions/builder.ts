import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, type ToolExecutionApi } from "@earendil-works/pi-durable"
import type { ExtensionBundle, ExtensionInfo, ExtensionResult } from "@yuki/protocol"
import { filesOf, type RoomFs } from "../../files/room-fs"
import { declareEffect, type Effect, effectOf } from "@yuki/agent/effects"
import type { CheckReport } from "@yuki/sandbox/check"
import { extensionName } from "@yuki/sandbox/compile"
import { isRunTainted } from "@yuki/agent/trust"

export const BUILDER = "extension-builder"
const ROOT = "extensions"
const TEXT_FILE = /\.(?:js|mjs|json|md|txt)$/i

export type BuilderPorts = {
  check: (bundle: unknown, tools: ReadonlyMap<string, Effect>) => Promise<CheckReport>
  propose: (bundle: unknown, tainted: boolean) => Promise<ExtensionResult>
  list: () => Promise<ExtensionInfo[]>
  source: (name: string) => Promise<ExtensionBundle | null>
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) })
const NAME = Type.Object({ name: Type.String({ description: "the extension's folder name under /extensions" }) })

async function readBundle(fs: RoomFs, name: string): Promise<{ bundle: unknown } | { error: string }> {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(name)) return { error: `"${name}" is not an extension name: lowercase letters, digits, and dashes` }
  const dir = `${ROOT}/${name}`
  const listed = await fs.list(dir, true)
  if (!listed.ok) return { error: `there is no /${dir} folder. write /${dir}/extension.json first` }
  let manifest: unknown
  const files: Record<string, string> = {}
  for (const entry of listed.value) {
    if (entry.kind !== "file" || !TEXT_FILE.test(entry.path)) continue
    const rel = entry.path.replace(/^\/+/, "").slice(dir.length + 1)
    const read = await fs.readTextFile(`/${entry.path.replace(/^\/+/, "")}`)
    if (!read.ok) return { error: `could not read /${entry.path}` }
    if (rel === "extension.json") {
      try {
        manifest = JSON.parse(read.value)
      } catch (e) {
        return { error: `/${dir}/extension.json is not valid json: ${e instanceof Error ? e.message : String(e)}` }
      }
    } else files[rel] = read.value
  }
  if (manifest === undefined) return { error: `/${dir}/extension.json is missing` }
  return { bundle: { manifest, files } }
}

async function agentTools(api: ToolExecutionApi, context: Context, skip: string): Promise<Map<string, Effect>> {
  const agent = await api.agent(context)
  const own = new Set((agent.extensions.find((e) => e.name === extensionName(skip))?.tools ?? []).map((t) => t.name))
  const map = new Map<string, Effect>()
  for (const t of agent.tools) if (!own.has(t.name)) map.set(t.name, effectOf(t)?.effect ?? "external")
  return map
}

export function builderExtension(ports: BuilderPorts): Extension {
  return defineExtension({
    name: BUILDER,
    tools: [
      declareEffect(
        "read",
        defineTool({
          name: "extension_check",
          description:
            "check the extension in /extensions/<name>/: the manifest, the script, and its tests, in a sandbox with mocks. run it until it says ok, then extension_propose. read the build-an-extension skill first.",
          parameters: NAME,
          execute: async ({ name }, api, context) => {
            const read = await readBundle(filesOf(api), name)
            if ("error" in read) return text(read.error, true)
            const report = await ports.check(read.bundle, await agentTools(api, context, name))
            return text(report.lines.join("\n"), !report.ok)
          },
        }),
      ),
      declareEffect(
        "message",
        defineTool({
          name: "extension_propose",
          description:
            "send the extension in /extensions/<name>/ to the human to review and install. it must pass extension_check. you cannot install it; tell the human it waits in settings → extensions.",
          parameters: NAME,
          execute: async ({ name }, api, context) => {
            const read = await readBundle(filesOf(api), name)
            if ("error" in read) return text(read.error, true)
            const report = await ports.check(read.bundle, await agentTools(api, context, name))
            if (!report.ok) return text(`not proposed: fix these first.\n${report.lines.join("\n")}`, true)
            const out = await ports.propose(read.bundle, isRunTainted(api))
            if (!out.ok) return text(`not proposed: ${out.error}${out.problems?.length ? `\n${out.problems.join("\n")}` : ""}`, true)
            const p = out.proposal!
            return text(`proposed ${p.name} ${p.version}${p.replaces ? " (an update)" : ""}. it waits for the human in settings → extensions; it does nothing until they install it.`)
          },
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "extension_list",
          description: "list the human's installed extensions: name, version, on or off, tools, and any error",
          parameters: Type.Object({}),
          replay: "safe",
          execute: async () => {
            const all = await ports.list()
            if (!all.length) return text("no extensions installed")
            return text(
              all
                .map((x) => {
                  const tools = Object.keys(x.manifest.tools ?? {})
                  const unset = x.secrets.filter((s) => !s.set).map((s) => s.name)
                  return `${x.name} ${x.version} ${x.enabled ? "on" : "off"}${x.agents ? ` for ${x.agents.join(", ")}` : ""}: ${x.description}${tools.length ? ` tools: ${tools.join(", ")}.` : ""}${unset.length ? ` secrets not set: ${unset.join(", ")}.` : ""}${x.error ? ` error: ${x.error}` : ""}`
                })
                .join("\n"),
            )
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "extension_open",
          description: "copy an installed extension's files into /extensions/<name>/ so you can change it, then check and propose the new version",
          parameters: NAME,
          execute: async ({ name }, api) => {
            const bundle = await ports.source(name)
            if (!bundle) return text(`no installed extension named ${name}`, true)
            const dir = `/${ROOT}/${name}`
            const write = async (path: string, body: string) => {
              const out = await filesOf(api).writeFile(path, body)
              if (!out.ok) throw new Error(`could not write ${path}: ${out.error.message}`)
            }
            try {
              await write(`${dir}/extension.json`, `${JSON.stringify(bundle.manifest, null, 2)}\n`)
              for (const [path, body] of Object.entries(bundle.files)) await write(`${dir}/${path}`, body)
            } catch (e) {
              return text(e instanceof Error ? e.message : String(e), true)
            }
            return text(`copied ${name} ${bundle.manifest.version} to ${dir}: extension.json${Object.keys(bundle.files).map((f) => `, ${f}`).join("")}. bump "version" when you change it.`)
          },
        }),
      ),
    ],
  })
}
