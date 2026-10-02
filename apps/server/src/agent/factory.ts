import type { AuthResult, Models } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import { type AgentChange, createRegistry, defineExtension, type Extension, type HarnessSettings, type ModelRef, type Registry } from "@earendil-works/pi-durable"
import { Subagent } from "./extensions/subagent"
import { effectTable } from "./effects"
import { type Approvals, trustExtension } from "./extensions/trust"
import { type FilesPort, filesExtension } from "./extensions/files"
import { webExtension } from "./extensions/web"
import { type MemoryPort, memoryExtension } from "./extensions/memory"
import { type WorkspacePort, workspaceExtension } from "./extensions/workspace"
import { type MessagingPort, messagingExtension } from "./extensions/messaging"
import { baseSections, type RoleInput } from "./prompt"

// Architecture sections 2 and 16. This file is the only place that installs extensions and chooses
// a conversation's extensions. `pi-durable` applies hooks only for selected extensions, so a
// guard such as `Trust` holds only if every agent is built here.

export type BuildAgentInput = RoleInput & {
  model: ModelRef
  /** The room's files (P8-05). Without it the agent has no file tools, as in the fake agent. */
  files?: FilesPort
  /** The user's memory (P5-02). Without it the agent has no memory tools and no profile, as in the fake agent. */
  memory?: MemoryPort
  /** The room's task board, activity log, and notes (P6-02). Without it the agent has no workspace tools. */
  workspace?: WorkspacePort
  /** The room's team tools (P6-03). Without it the agent has no messaging tools. */
  messaging?: () => MessagingPort | null
  /** Tests and the dev-only fake agent only, such as the slow tool of P1-12. Selected after every standard extension. */
  testExtensions?: readonly Extension[]
  /** Human approval records for `external` tools in a tainted run (P7-02). Default: none. */
  approvals?: Approvals
}

export type BuiltAgent = {
  /** Every extension below, installed in selection order. One registry per agent process. */
  registry: Registry
  /** The root conversation's agent choices. `extensions` is an exact list, never an edit. */
  agent: AgentChange
}

/** The extension every agent selects first: the base system prompt. */
export const BASE = "base"

/**
 * The extensions every agent selects, in order. Order is prompt order. A new extension is one more
 * entry here: `Trust` (P3), `Memory`, `Skills`, and the team tools come next. An extension that
 * fills a prompt slot (`skills`, `profile`) does it with `wrapSection` and goes after `Base`.
 */
function extensionsFor(input: BuildAgentInput): Extension[] {
  return [
    defineExtension({ name: BASE, sections: baseSections(input) }),
    ...(input.memory ? [memoryExtension(input.memory)] : []),
    ...(input.files ? [filesExtension(input.files)] : []),
    ...(input.workspace ? [workspaceExtension(input.workspace, input.lead)] : []),
    webExtension(),
    ...(input.messaging ? [messagingExtension(input.messaging)] : []),
    Subagent,
    ...(input.testExtensions ?? []),
  ]
}

/**
 * Architecture section 16. `Trust` is always selected, last, so its `beforeTool` sees the final
 * arguments and its `afterTool` wraps the final result. `effectTable` throws for a tool with no
 * declared effect, so such an agent is never built.
 */
function withTrust(extensions: Extension[], input: BuildAgentInput): Extension[] {
  return [...extensions, trustExtension({ effects: effectTable(extensions), approvals: input.approvals })]
}

export function buildAgent(input: BuildAgentInput): BuiltAgent {
  const extensions = withTrust(extensionsFor(input), input)
  const registry = createRegistry()
  for (const extension of extensions) registry.install(extension)
  return { registry, agent: { model: input.model, extensions } }
}

/**
 * ASSUMPTION: the model of an agent nobody picked a model for. It is the test model of architecture
 * section 11.6 until the model picker (P4-05) lets a user choose.
 */
export const DEFAULT_MODEL: ModelRef = { provider: "opencode-go", modelId: "deepseek-v4.1-flash" }

/** The run's request auth for one provider, from `UserDO.turnContext` (section 11.3). Undefined when the user has none. */
export type RunAuth = (provider: string) => Promise<AuthResult | undefined>

/**
 * A `Models` whose every provider takes its auth from `auth` and nothing else: no environment, no
 * files, no stored credential. The host fills `auth` once per run, so each run answers with the
 * user's credential as it was when the run began. `sessionId` must be stable per agent: OpenCode Go
 * answers 400 MissingSessionID without the `x-opencode-session` header (P0-05), and pi-durable
 * passes headers only through `settings.stream.headers`.
 */
export function userModels(auth: RunAuth, sessionId: string): { models: Models; settings: HarnessSettings } {
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } })
  for (const provider of builtinProviders()) {
    models.setProvider({ ...provider, auth: { apiKey: { name: provider.name, resolve: () => auth(provider.id) } } })
  }
  return { models, settings: { stream: { headers: { "x-opencode-session": sessionId } } } }
}
