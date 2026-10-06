import type { AuthResult, Models } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import { type AgentChange, createRegistry, defineExtension, type Extension, type HarnessSettings, type ModelRef, type Registry } from "@earendil-works/pi-durable"
import { Subagent } from "./extensions/subagent"
import { type EffectDeclaration, effectTable } from "./effects"
import { type Approvals, trustExtension } from "./extensions/trust"
import type { Authority } from "../lib/origin"
import { type FilesOptions, filesExtension } from "./extensions/files"
import { webExtension } from "./extensions/web"
import type { Fetcher } from "../lib/safe-fetch"
import { type MemoryPort, memoryExtensions } from "./extensions/memory"
import { type WorkspacePort, workspaceExtension } from "./extensions/workspace"
import { type MessagingPort, messagingExtension } from "./extensions/messaging"
import { type RemindersPort, remindersExtension } from "./extensions/reminders"
import { skillsExtension } from "./extensions/skills"
import { selfExtension } from "./extensions/self"
import { type ChiefPort, chiefExtension } from "./extensions/chief"
import { presenceExtension } from "./extensions/presence"
import type { SoulPort } from "../files/room-fs"
import { type ExecutorCall, type ExecutorTool, executorExtension } from "../integrations/executor/tools"
import type { ApprovalGate } from "../integrations/executor/approval"
import { baseSections, type RoleInput } from "./prompt"
import { compileExtension, extensionName, type Installed, type ScriptPorts, VmPool } from "./script/compile"
import { type BuilderPorts, builderExtension } from "./extensions/builder"

// Architecture sections 2 and 16. This file is the only place that installs extensions and chooses
// a conversation's extensions. `pi-durable` applies hooks only for selected extensions, so a
// guard such as `Trust` holds only if every agent is built here.

export type BuildAgentInput = RoleInput & {
  model: ModelRef
  /** The room's files (P8-05). Without it the agent has no file tools, as in the fake agent. */
  files?: FilesOptions
  /** The agent's soul (section 7.10). With `files`, fills the soul and chat sections. */
  soul?: SoulPort
  /** kiko only (section 7.11): making the human's agents and groups. */
  chief?: ChiefPort
  /** Tells the room what each tool call is about, for the team board (section 7.12). */
  presence?: (doing: string) => Promise<unknown>
  /** The user's memory (section 13). Without it the agent has no memory tools, as in the fake agent. */
  memory?: MemoryPort
  /** The room's task board, activity log, and notes (P6-02). Without it the agent has no workspace tools. */
  workspace?: WorkspacePort
  /** The human's Executor tools for this run (P7-04). Without it the agent has none. */
  executor?: { tools: readonly ExecutorTool[]; call: ExecutorCall; gate?: ApprovalGate }
  /** The user's reminders (P5-06). Without it the agent has no reminder tools. */
  reminders?: { port: () => RemindersPort | null; tz: () => string }
  /** The room's team tools (P6-03). Without it the agent has no messaging tools. */
  messaging?: () => MessagingPort | null
  /** Tests and the dev-only fake agent only, such as the slow tool of P1-12. Selected after every standard extension. */
  testExtensions?: readonly Extension[]
  /** The human's cards for `external` tools in a run nobody asked for (section 25.3). Default: none. */
  approvals?: Approvals
  /** The authority of the run in flight (section 25.3). Default: a human's. */
  authority?: () => Authority
  /** What user extensions reach (section 24). Without it the agent runs no user extension. */
  scripts?: ScriptPorts
  /** `extension_check` and `extension_propose` (section 24.6). Without it the agent cannot write extensions. */
  builder?: BuilderPorts
  /** Where `web_fetch` sends its requests (section 17.3). Default: the global fetch. */
  egress?: Fetcher
}

export type BuiltAgent = {
  /** Every extension below, installed in selection order. One registry per agent process. */
  registry: Registry
  /** The root conversation's agent choices. `extensions` is an exact list, never an edit. */
  agent: AgentChange
  /** The user's extensions in this registry. Synced before each run. */
  extensions: UserExtensions
}

/** The extension every agent selects first: the base system prompt. */
export const BASE = "base"

/**
 * The extensions every agent selects, in order. Order is prompt order. A new extension is one more
 * entry here: `Trust` (P3), `Memory`, `Skills`, and the team tools come next. An extension that
 * fills a prompt slot (`soul`, `skills`) does it with `wrapSection` and goes after `Base`.
 */
function extensionsFor(input: BuildAgentInput): Extension[] {
  return [
    defineExtension({ name: BASE, sections: baseSections(input) }),
    ...(input.files && input.soul ? [selfExtension(input.files.fs, input.soul)] : []),
    ...(input.memory ? memoryExtensions(input.memory) : []),
    ...(input.files ? [filesExtension(input.files)] : []),
    skillsExtension(input.files?.fs),
    ...(input.workspace ? [workspaceExtension(input.workspace, input.lead)] : []),
    webExtension(input.egress, input.files?.fs),
    ...(input.messaging ? [messagingExtension(input.messaging, input.lead)] : []),
    ...(input.chief ? [chiefExtension(input.chief)] : []),
    ...(input.presence ? [presenceExtension(input.presence)] : []),
    ...(input.reminders ? [remindersExtension(input.reminders.port, input.reminders.tz)] : []),
    ...(input.executor?.tools.length ? [executorExtension(input.executor.tools, input.executor.call, input.executor.gate, input.files?.fs)] : []),
    ...(input.builder ? [builderExtension(input.builder)] : []),
    Subagent,
    ...(input.testExtensions ?? []),
  ]
}

/**
 * Architecture section 16. `Trust` is always selected, last, so its `beforeTool` sees the final
 * arguments and its `afterTool` wraps the final result. `effectTable` throws for a tool with no
 * declared effect, so such an agent is never built. The effect map is live: the user's extensions
 * add their tools to it when they sync.
 */
export function buildAgent(input: BuildAgentInput): BuiltAgent {
  const builtins = extensionsFor(input)
  const effects = new Map(effectTable(builtins))
  const trust = trustExtension({ effects, approvals: input.approvals, ...(input.authority ? { authority: input.authority } : {}) })
  const registry = createRegistry()
  for (const extension of [...builtins, trust]) registry.install(extension)
  const extensions = new UserExtensions(registry, builtins, trust, effects, input.scripts)
  return { registry, agent: { model: input.model, extensions: [...builtins, trust] }, extensions }
}

/** One user extension that could not be installed in this agent, and why. */
export type ExtensionProblem = { name: string; hash: string; error: string }

/**
 * Architecture section 24.5. The user's extensions in one agent's registry. `sync` installs the
 * given versions, removes the rest, and returns the selection the root conversation should have:
 * every built-in extension, then the user's in name order, then `trust`. A user extension never
 * replaces a built-in tool and never shares a tool name with another user extension: such an
 * extension is left out and reported, and the agent runs without it.
 */
export class UserExtensions {
  private installed = new Map<string, { hash: string; extension: Extension }>()
  private readonly pool?: VmPool
  private readonly reserved: ReadonlySet<string>

  constructor(
    private readonly registry: Registry,
    private readonly builtins: readonly Extension[],
    private readonly trust: Extension,
    private readonly effects: Map<string, EffectDeclaration>,
    private readonly ports?: ScriptPorts,
  ) {
    if (ports) this.pool = new VmPool(ports.wasm)
    this.reserved = new Set(builtins.flatMap((e) => (e.tools ?? []).map((t) => t.name)))
  }

  /** The exact selection: built-ins, user extensions by name, trust last. */
  selection(): Extension[] {
    const users = [...this.installed.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v.extension)
    return [...this.builtins, ...users, this.trust]
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
    this.effects.clear()
    for (const [k, v] of effectTable(this.selection())) this.effects.set(k, v)
    return problems
  }

  /** Frees every extension VM. The agent calls it when it goes idle (section 24.3). */
  release(): void {
    this.pool?.release()
  }

  /** The registry names of the user extensions now installed. */
  names(): string[] {
    return [...this.installed.keys()].map(extensionName)
  }
}

/**
 * ASSUMPTION: the model of an agent nobody picked a model for. It is the test model of architecture
 * section 11.6 until the model picker (P4-05) lets a user choose.
 */
export const DEFAULT_MODEL: ModelRef = { provider: "opencode-go", modelId: "deepseek-v4.1-flash" }

/** pi-ai APIs whose adapter throws on a custom fetch (`api/google-generative-ai.js`, `api/google-vertex.js`). */
const NO_CUSTOM_FETCH = new Set(["google-generative-ai", "google-vertex"])

/** The run's request auth for one provider, from `UserDO.turnContext` (section 11.3). Undefined when the user has none. */
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
    // With `egress`, every model request goes out through it (section 17.3: the Free plan's 50
    // subrequests per invocation would otherwise end a long run partway through).
    // pi-ai's Google adapters refuse a custom fetch, so their requests keep the global one.
    const via = (model: { api: string }, options: object | undefined) => (egress && !NO_CUSTOM_FETCH.has(model.api) ? { ...options, fetch: egress } : options)
    const routed = egress
      ? {
          stream: ((model, context, options) => provider.stream(model, context, via(model, options) as never)) as typeof provider.stream,
          streamSimple: ((model, context, options) => provider.streamSimple(model, context, via(model, options) as never)) as typeof provider.streamSimple,
        }
      : {}
    models.setProvider({ ...provider, ...routed, auth: { apiKey: { name: provider.name, resolve: () => auth(provider.id) } } })
  }
  return { models, settings: { stream: { headers: { "x-opencode-session": sessionId } } } }
}
