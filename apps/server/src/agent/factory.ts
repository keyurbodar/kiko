import type { AuthResult, Models } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import { type AgentChange, createRegistry, defineExtension, type Extension, type HarnessSettings, type ModelRef, type Registry } from "@earendil-works/pi-durable"
import { Subagent } from "./extensions/subagent"
import { effectTable } from "./effects"
import { type Approvals, trustExtension } from "./extensions/trust"
import { type FilesOptions, filesExtension } from "./extensions/files"
import { webExtension } from "./extensions/web"
import { type MemoryPort, memoryExtension } from "./extensions/memory"
import { type WorkspacePort, workspaceExtension } from "./extensions/workspace"
import { type MessagingPort, messagingExtension } from "./extensions/messaging"
import { type RemindersPort, remindersExtension } from "./extensions/reminders"
import { skillsExtension } from "./extensions/skills"
import { selfExtension } from "./extensions/self"
import { type ChiefPort, chiefExtension } from "./extensions/chief"
import type { SoulPort } from "../files/room-fs"
import { type ExecutorCall, type ExecutorTool, executorExtension } from "../integrations/executor/tools"
import type { ApprovalGate } from "../integrations/executor/approval"
import { baseSections, type RoleInput } from "./prompt"

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
  /** The user's memory (P5-02). Without it the agent has no memory tools and no profile, as in the fake agent. */
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
    ...(input.files && input.soul ? [selfExtension(input.files.fs, input.soul)] : []),
    ...(input.memory ? [memoryExtension(input.memory)] : []),
    ...(input.files ? [filesExtension(input.files)] : []),
    skillsExtension(input.files?.fs),
    ...(input.workspace ? [workspaceExtension(input.workspace, input.lead)] : []),
    webExtension(),
    ...(input.messaging ? [messagingExtension(input.messaging, input.lead)] : []),
    ...(input.chief ? [chiefExtension(input.chief)] : []),
    ...(input.reminders ? [remindersExtension(input.reminders.port, input.reminders.tz)] : []),
    ...(input.executor?.tools.length ? [executorExtension(input.executor.tools, input.executor.call, input.executor.gate)] : []),
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
