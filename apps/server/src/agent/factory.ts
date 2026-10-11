import type { AuthResult, Models } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import { type AgentChange, createRegistry, defineExtension, type Extension, type HarnessSettings, type ModelRef, type Registry } from "@earendil-works/pi-durable"
import { subagentExtension } from "./extensions/subagent"
import { effectTable } from "@yuki/agent/effects"
import { type FilesOptions, filesExtension } from "./extensions/files"
import { webExtension } from "./extensions/web"
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
import { composioExtension } from "../integrations/composio/tools"
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
  reminders?: { port: () => RemindersPort | null; tz: () => string }
  messaging?: () => MessagingPort | null
  testExtensions?: readonly Extension[]
  scripts?: ScriptPorts
  builder?: BuilderPorts
  egress?: Fetcher
}

export type BuiltAgent = {
  registry: Registry
  agent: AgentChange
  extensions: UserExtensions
}

export const BASE = "base"

function extensionsFor(input: BuildAgentInput): Extension[] {
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
    ...(input.builder ? [builderExtension(input.builder)] : []),
    subagentExtension(),
    ...(input.testExtensions ?? []),
  ]
}

export function buildAgent(input: BuildAgentInput): BuiltAgent {
  const builtins = extensionsFor(input)
  // Throws when a tool declares no effect. An extension script reads the effect to decide what it may call.
  effectTable(builtins)
  const registry = createRegistry()
  for (const extension of builtins) registry.install(extension)
  const extensions = new UserExtensions(registry, builtins, input.scripts)
  // The lowest reasoning a model offers: pi-ai clamps "minimal" up to the first level the model
  // supports. A chat reply waits on every turn, and on tool-heavy tasks the default level made each
  // turn take 2 to 5 s longer with the same answers.
  return { registry, agent: { model: input.model, thinkingLevel: "minimal", extensions: builtins }, extensions }
}

export type ExtensionProblem = { name: string; hash: string; error: string }

export class UserExtensions {
  private installed = new Map<string, { hash: string; extension: Extension }>()
  private readonly pool?: VmPool
  private readonly reserved: ReadonlySet<string>

  constructor(
    private readonly registry: Registry,
    private readonly builtins: readonly Extension[],
    private readonly ports?: ScriptPorts,
  ) {
    if (ports) this.pool = new VmPool(ports.wasm)
    this.reserved = new Set(builtins.flatMap((e) => (e.tools ?? []).map((t) => t.name)))
  }

  selection(): Extension[] {
    const users = [...this.installed.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v.extension)
    return [...this.builtins, ...users]
  }

  sync(list: readonly Installed[]): ExtensionProblem[] {
    if (!this.ports || !this.pool) return list.map((i) => ({ name: i.name, hash: i.hash, error: "this agent cannot run extensions" }))
    const problems: ExtensionProblem[] = []
    const next = new Map<string, { hash: string; extension: Extension }>()
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
      next.set(item.name, current?.hash === item.hash ? current : { hash: item.hash, extension: compileExtension(item, this.pool, this.ports) })
    }
    for (const [name, v] of this.installed) if (next.get(name) !== v) this.registry.uninstall(v.extension)
    for (const [name, v] of next) if (this.installed.get(name) !== v) this.registry.install(v.extension)
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
  return { models, settings: { stream: { headers: { "x-opencode-session": sessionId } } } }
}
