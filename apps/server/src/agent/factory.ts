import type { AuthResult, Models } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { providers } from "../models/catalog"
import { type AgentChange, createRegistry, defineExtension, type Extension, type HarnessSettings, type ModelRef, type Registry } from "@earendil-works/pi-durable"
import { workExtensions } from "./extensions/work"
import { withTextToolCalls } from "./tool-markup"
import type { Workers } from "@kiko/agent/workers"
import { effectTable } from "@kiko/agent/effects"
import { type FilesOptions, filesExtension } from "./extensions/files"
import { type MemoryPort, memoryExtensions } from "@kiko/memory/tools"
import { type LoopPort, loopExtension } from "@kiko/memory/loop-tool"
import { type WorkspacePort, workspaceExtension } from "./extensions/workspace"
import { type MessagingPort, messagingExtension } from "./extensions/messaging"
import { type RoutinesPort, routinesExtension } from "./extensions/routines"
import { type RecipesPort, skillsExtension } from "./extensions/skills"
import { selfExtension } from "./extensions/self"
import { type GroupsPort, groupsExtension } from "./extensions/chief"
import { presenceExtension, type StepsPort } from "./extensions/presence"
import { composioDescribe } from "../integrations/composio/step"
import type { RoomFs, SoulPort } from "../files/room-fs"
import type { ComposioCall, ComposioTool } from "../integrations/composio/client"
import { COMPOSIO, composioExtension } from "../integrations/composio/tools"
import { connectAppExtension } from "../integrations/composio/connect-tool"
import { BROWSER_EXT, type BrowserToolDeps, browserExtension, browserInfoExtension } from "./browser/tools"
import { baseSections, type RoleInput } from "./prompt"
import { count } from "../lib/dev-guard"
import type { ThinkingLevel } from "@kiko/protocol"
import { thinkingFor } from "./thinking"

export type BuildAgentInput = RoleInput & {
  /** Absent until the human picks one. A run then stops before it reaches a model. */
  model?: ModelRef
  thinkingLevel?: ThinkingLevel
  files?: Omit<FilesOptions, "touched"> & { fs: RoomFs }
  soul?: SoulPort
  runStamp?: () => number
  groups?: GroupsPort
  presence?: StepsPort
  /** The run the agent is in now, so a worker it starts knows whose steps its calls are. */
  runId?: () => string | null
  memory?: MemoryPort
  loops?: () => LoopPort | null
  workspace?: WorkspacePort
  composio?: { tools: readonly ComposioTool[]; call: ComposioCall; resolve?: (app: string) => Promise<string | null> }
  browser?: BrowserToolDeps
  routines?: { port: () => RoutinesPort | null }
  recipes?: RecipesPort
  messaging?: () => MessagingPort | null
  testExtensions?: readonly Extension[]
  work?: Workers
}

export type BuiltAgent = {
  registry: Registry
  agent: AgentChange
}

export const BASE = "base"

export const WORKER_ONLY: readonly string[] = [COMPOSIO, BROWSER_EXT]
export const workerOnly = (name: string): boolean => WORKER_ONLY.includes(name)
export const forTalker = (extensions: readonly Extension[]): Extension[] => extensions.filter((e) => !workerOnly(e.name))

function extensionsFor(input: BuildAgentInput, all: () => readonly Extension[]): Extension[] {
  return [
    defineExtension({ name: BASE, sections: baseSections(input) }),
    ...(input.files && input.soul ? [selfExtension(input.files.fs, input.soul, input.runStamp)] : []),
    ...(input.memory ? memoryExtensions(input.memory) : []),
    ...(input.loops ? [loopExtension(input.loops)] : []),
    ...(input.files ? [filesExtension({ acceptsImages: input.files.acceptsImages, touched: (conversationId, paths) => input.work?.touched(conversationId, paths) })] : []),
    skillsExtension(input.files?.fs, input.runStamp, input.recipes),
    ...(input.workspace ? [workspaceExtension(input.workspace, input.lead)] : []),
    ...(input.messaging ? [messagingExtension(input.messaging)] : []),
    ...(input.groups ? [groupsExtension(input.groups)] : []),
    ...(input.presence ? [presenceExtension({ ...input.presence, ...(input.composio?.tools.length ? { describe: composioDescribe(input.composio.tools) } : {}) })] : []),
    ...(input.routines ? [routinesExtension(input.routines.port)] : []),
    ...(input.composio?.tools.length ? [composioExtension(input.composio.tools, input.composio.call, input.files?.fs)] : []),
    ...(input.composio?.tools.length ? connectAppExtension(input.composio.tools, input.composio.call, input.composio.resolve) : []),
    ...(input.browser ? [browserExtension(input.browser), browserInfoExtension(input.browser)] : []),
    ...(input.work ? workExtensions(input.work, all, input.runId) : []),
    ...(input.testExtensions ?? []),
  ]
}

export function buildAgent(input: BuildAgentInput): BuiltAgent {
  const builtins = extensionsFor(input, () => builtins)
  // Throws when a tool declares no effect or two tools share a name with different effects.
  effectTable(builtins)
  const registry = createRegistry()
  for (const extension of builtins) registry.install(extension)
  return { registry, agent: { ...(input.model ? { model: input.model } : {}), thinkingLevel: input.thinkingLevel ?? (input.model ? thinkingFor(input.model) : "off"), extensions: forTalker(builtins) } }
}

/** pi-ai APIs whose adapter throws on a custom fetch (`api/google-generative-ai.js`, `api/google-vertex.js`). */
const NO_CUSTOM_FETCH = new Set(["google-generative-ai", "google-vertex"])

function timed<S extends { result(): Promise<unknown> }>(modelId: string, stream: S, reasoning?: string): S {
  const t = performance.now()
  count("model.turns")
  count(`model.id.${modelId}`)
  count(`model.reasoning.${reasoning ?? "off"}`)
  void stream.result().then(() => count("model.ms", Math.round(performance.now() - t)), () => {})
  return stream
}

/**
 * pi-durable writes a run's system entries after its first input, so the transcript never opens with a system
 * message. For a model that may add tools mid-conversation (Kimi K3), pi-ai then sends the agent's whole tool list
 * as a `{ role: "system", tools }` message with no content, and OpenCode Go answers 400 "Invalid request
 * parameters". With the flag off, every tool goes in the request's `tools` field, as for every other model.
 */
function unanchored<M extends { compat?: object }>(model: M): M {
  return { ...model, compat: { ...model.compat, supportsMidConvoToolAdditions: false } }
}

export type RunAuth = (provider: string) => Promise<AuthResult | undefined>

/**
 * A `Models` whose every provider takes its auth from `auth` and nothing else: no environment, no
 * files, no stored credential. The host fills `auth` once per run, so each run answers with the
 * user's credential as it was when the run began. `sessionId` must be stable per agent: OpenCode Go
 * answers 400 MissingSessionID without the `x-opencode-session` header (P0-05), and pi-durable
 * passes headers only through `settings.stream.headers`.
 */
/**
 * A model error ends the run at once, and the human decides: the transcript shows the failure with a
 * Retry button. pi-durable's own retries would keep the agent typing for about 15 seconds first.
 */
export const RUN_SETTINGS: HarnessSettings = { toolExecution: "parallel", retry: { enabled: false } }

export function userModels(auth: RunAuth, sessionId: string, egress?: typeof fetch): { models: Models; settings: HarnessSettings } {
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } })
  for (const provider of providers()) {
    const via = (model: { api: string }, options: object | undefined) => (egress && !NO_CUSTOM_FETCH.has(model.api) ? { ...options, fetch: egress } : options)
    const routed = {
      stream: ((model, context, options) => timed(model.id, withTextToolCalls(provider.stream as never)(unanchored(model), context, via(model, options) as never))) as typeof provider.stream,
      streamSimple: ((model, context, options) => timed(model.id, withTextToolCalls(provider.streamSimple)(unanchored(model), context, via(model, options) as never), options?.reasoning)) as typeof provider.streamSimple,
    }
    models.setProvider({ ...provider, ...routed, auth: { apiKey: { name: provider.name, resolve: () => auth(provider.id) } } })
  }
  return { models, settings: { ...RUN_SETTINGS, stream: { headers: { "x-opencode-session": sessionId } } } }
}
