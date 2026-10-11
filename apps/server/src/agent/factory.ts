import type { AuthResult, Models } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import { type AgentChange, createRegistry, defineExtension, type Extension, type HarnessSettings, type ModelRef, type Registry } from "@earendil-works/pi-durable"
import { NOT_FOR_WORKERS, workExtensions } from "./extensions/work"
import type { Workers } from "@yuki/agent/workers"
import { effectTable } from "@yuki/agent/effects"
import { type FilesOptions, filesExtension } from "./extensions/files"
import { WEB, webExtension } from "./extensions/web"
import type { Fetcher } from "@yuki/durable/safe-fetch"
import { type MemoryPort, memoryExtensions } from "@yuki/memory/tools"
import { type LoopPort, loopExtension } from "@yuki/memory/loop-tool"
import { type WorkspacePort, workspaceExtension } from "./extensions/workspace"
import { type MessagingPort, messagingExtension } from "./extensions/messaging"
import { type RemindersPort, remindersExtension } from "./extensions/reminders"
import { skillsExtension } from "./extensions/skills"
import { selfExtension } from "./extensions/self"
import { type ChiefPort, chiefExtension } from "./extensions/chief"
import { presenceExtension } from "./extensions/presence"
import type { RoomFs, SoulPort } from "../files/room-fs"
import type { ComposioCall, ComposioTool } from "../integrations/composio/client"
import { COMPOSIO, composioExtension } from "../integrations/composio/tools"
import { BROWSER_EXT, type BrowserToolDeps, browserExtension } from "./browser/tools"
import { baseSections, type RoleInput } from "./prompt"
import { compileExtension, extensionName, type Installed, type ScriptPorts, VmPool } from "@yuki/sandbox/compile"
import { type BuilderPorts, builderExtension } from "./extensions/builder"
import { count } from "../lib/dev-stats"

export type BuildAgentInput = RoleInput & {
  model: ModelRef
  /** `fs` reads the chat's files outside a tool call, for the prompt and for saved results. Tools use `filesOf(api)`. */
  files?: FilesOptions & { fs: RoomFs }
  soul?: SoulPort
  runStamp?: () => number
  chief?: ChiefPort
  presence?: (doing: string) => Promise<unknown>
  memory?: MemoryPort
  /** The human's open loops (initiative). */
  loops?: () => LoopPort | null
  workspace?: WorkspacePort
  composio?: { tools: readonly ComposioTool[]; call: ComposioCall }
  /** Only when the user has a Kernel key (phase 17). */
  browser?: BrowserToolDeps
  reminders?: { port: () => RemindersPort | null; tz: () => string }
  messaging?: () => MessagingPort | null
  testExtensions?: readonly Extension[]
  scripts?: ScriptPorts
  builder?: BuilderPorts
  egress?: Fetcher
  /** The agent's background workers (architecture section 8). Without it the agent has no work tools. */
  work?: Workers
}

export type BuiltAgent = {
  registry: Registry
  agent: AgentChange
  extensions: UserExtensions
}

export const BASE = "base"

/** A user extension's tools live in their own extension, named `ext:<name>/tools`, so the talker can leave them out. */
export const TOOLS_SUFFIX = "/tools"

/**
 * Architecture section 8. What only a worker gets: tools that leave the object or can take long. The
 * talker gets every other extension, so slow work cannot block the human's messages. Keyed by
 * extension name: the web, the human's connected apps, the browser, and the tools of every user extension. A
 * user extension's sections and hooks stay with the talker.
 */
export const WORKER_ONLY: readonly string[] = [WEB, COMPOSIO, BROWSER_EXT]
export const workerOnly = (name: string): boolean => WORKER_ONLY.includes(name) || (name.startsWith("ext:") && name.endsWith(TOOLS_SUFFIX))
/** The talker's extensions: all of them minus `WORKER_ONLY`, in the same order, so the prompt cache holds. */
export const forTalker = (extensions: readonly Extension[]): Extension[] => extensions.filter((e) => !workerOnly(e.name))

function extensionsFor(input: BuildAgentInput, all: () => readonly Extension[]): Extension[] {
  return [
    defineExtension({ name: BASE, sections: baseSections(input) }),
    ...(input.files && input.soul ? [selfExtension(input.files.fs, input.soul, input.runStamp)] : []),
    ...(input.memory ? memoryExtensions(input.memory) : []),
    ...(input.loops ? [loopExtension(input.loops)] : []),
    ...(input.files ? [filesExtension(input.files)] : []),
    skillsExtension(input.files?.fs, input.runStamp),
    ...(input.workspace ? [workspaceExtension(input.workspace, input.lead)] : []),
    webExtension(input.egress, input.files?.fs),
    ...(input.messaging ? [messagingExtension(input.messaging, input.lead)] : []),
    ...(input.chief ? [chiefExtension(input.chief)] : []),
    ...(input.presence ? [presenceExtension(input.presence)] : []),
    ...(input.reminders ? [remindersExtension(input.reminders.port, input.reminders.tz)] : []),
    ...(input.composio?.tools.length ? [composioExtension(input.composio.tools, input.composio.call, input.files?.fs)] : []),
    ...(input.browser ? [browserExtension(input.browser)] : []),
    ...(input.builder ? [builderExtension(input.builder)] : []),
    ...(input.work ? workExtensions(input.work, all) : []),
    ...(input.testExtensions ?? []),
  ]
}

export function buildAgent(input: BuildAgentInput): BuiltAgent {
  let extensions: UserExtensions | undefined
  const builtins = extensionsFor(input, () => extensions?.selection() ?? builtins)
  // Throws when a tool declares no effect. An extension script reads the effect to decide what it may call.
  effectTable(builtins)
  const registry = createRegistry()
  for (const extension of builtins) registry.install(extension)
  extensions = new UserExtensions(registry, builtins, input.scripts)
  // The lowest reasoning a model offers: pi-ai clamps "minimal" up to the first level the model
  // supports. A chat reply waits on every turn, and on tool-heavy tasks the default level made each
  // turn take 2 to 5 s longer with the same answers.
  return { registry, agent: { model: input.model, thinkingLevel: "minimal", extensions: forTalker(builtins) }, extensions }
}

/**
 * A compiled user extension as two: its sections, hooks, and wraps for every conversation, and its tools for workers only.
 * An extension whose tools call a talker-only tool (send_message, a reminder, the board) stays whole with the talker,
 * since a worker does not have what it calls.
 */
function split(extension: Extension, calls: readonly string[], talkerOnly: ReadonlySet<string>): Extension[] {
  if (!extension.tools?.length || calls.some((c) => talkerOnly.has(c))) return [extension]
  return [{ ...extension, tools: [] }, defineExtension({ name: `${extension.name}${TOOLS_SUFFIX}`, tools: extension.tools })]
}

export type ExtensionProblem = { name: string; hash: string; error: string }

export class UserExtensions {
  private installed = new Map<string, { hash: string; parts: Extension[] }>()
  private readonly pool?: VmPool
  private readonly reserved: ReadonlySet<string>
  private readonly talkerOnly: ReadonlySet<string>

  constructor(
    private readonly registry: Registry,
    private readonly builtins: readonly Extension[],
    private readonly ports?: ScriptPorts,
  ) {
    if (ports) this.pool = new VmPool(ports.wasm)
    this.reserved = new Set(builtins.flatMap((e) => (e.tools ?? []).map((t) => t.name)))
    this.talkerOnly = new Set(builtins.filter((e) => NOT_FOR_WORKERS.includes(e.name)).flatMap((e) => (e.tools ?? []).map((t) => t.name)))
  }

  /** Every extension, the worker's tools included. A worker takes this minus `NOT_FOR_WORKERS`. */
  selection(): Extension[] {
    const users = [...this.installed.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, v]) => v.parts)
    return [...this.builtins, ...users]
  }

  /** The talker's extensions (section 8). */
  talker(): Extension[] {
    return forTalker(this.selection())
  }

  sync(list: readonly Installed[]): ExtensionProblem[] {
    if (!this.ports || !this.pool) return list.map((i) => ({ name: i.name, hash: i.hash, error: "this agent cannot run extensions" }))
    const problems: ExtensionProblem[] = []
    const next = new Map<string, { hash: string; parts: Extension[] }>()
    const taken = new Map<string, string>()
    for (const item of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
      const tools = Object.keys(item.bundle.manifest.tools ?? {})
      const clash = tools.find((t) => this.reserved.has(t)) ?? null
      const shared = tools.find((t) => taken.has(t)) ?? null
      if (clash || shared) {
        const error = clash ? `tool ${clash} is a built-in tool; rename it` : `tool ${shared} is also in extension ${taken.get(shared!)}; rename one`
        problems.push({ name: item.name, hash: item.hash, error })
        continue
      }
      for (const t of tools) taken.set(t, item.name)
      const current = this.installed.get(item.name)
      next.set(item.name, current?.hash === item.hash ? current : { hash: item.hash, parts: split(compileExtension(item, this.pool, this.ports), item.bundle.manifest.calls ?? [], this.talkerOnly) })
    }
    for (const [name, v] of this.installed) if (next.get(name) !== v) for (const part of v.parts) this.registry.uninstall(part)
    for (const [name, v] of next) if (this.installed.get(name) !== v) for (const part of v.parts) this.registry.install(part)
    this.installed = next
    this.pool.retain(new Set([...next.values()].map((v) => v.hash)))
    return problems
  }

  release(): void {
    this.pool?.release()
  }

  names(): string[] {
    return [...this.installed.keys()].map(extensionName)
  }
}

/** Muse Spark at minimal reasoning answered a connected-app task in 9.3 s where DeepSeek V4.1 Flash took 16.6 s (2026-10-09). */
export const DEFAULT_MODEL: ModelRef = { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" }

/** pi-ai APIs whose adapter throws on a custom fetch (`api/google-generative-ai.js`, `api/google-vertex.js`). */
const NO_CUSTOM_FETCH = new Set(["google-generative-ai", "google-vertex"])

/** Counts a model turn and its time for the dev stats. Returns the stream itself. */
function timed<S extends { result(): Promise<unknown> }>(modelId: string, stream: S): S {
  const t = performance.now()
  count("model.turns")
  count(`model.id.${modelId}`)
  void stream.result().then(() => count("model.ms", Math.round(performance.now() - t)), () => {})
  return stream
}

export type RunAuth = (provider: string) => Promise<AuthResult | undefined>

/**
 * A `Models` whose every provider takes its auth from `auth` and nothing else: no environment, no
 * files, no stored credential. The host fills `auth` once per run, so each run answers with the
 * user's credential as it was when the run began. `sessionId` must be stable per agent: OpenCode Go
 * answers 400 MissingSessionID without the `x-opencode-session` header (P0-05), and pi-durable
 * passes headers only through `settings.stream.headers`.
 */
export function userModels(auth: RunAuth, sessionId: string, egress?: typeof fetch): { models: Models; settings: HarnessSettings } {
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } })
  for (const provider of builtinProviders()) {
    const via = (model: { api: string }, options: object | undefined) => (egress && !NO_CUSTOM_FETCH.has(model.api) ? { ...options, fetch: egress } : options)
    const routed = {
      stream: ((model, context, options) => timed(model.id, provider.stream(model, context, via(model, options) as never))) as typeof provider.stream,
      streamSimple: ((model, context, options) => timed(model.id, provider.streamSimple(model, context, via(model, options) as never))) as typeof provider.streamSimple,
    }
    models.setProvider({ ...provider, ...routed, auth: { apiKey: { name: provider.name, resolve: () => auth(provider.id) } } })
  }
  return { models, settings: { toolExecution: "parallel", stream: { headers: { "x-opencode-session": sessionId } } } }
}
