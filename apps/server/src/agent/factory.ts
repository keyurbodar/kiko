import type { Models } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go"
import { type AgentChange, createRegistry, defineExtension, type Extension, type HarnessSettings, type ModelRef, type Registry } from "@earendil-works/pi-durable"
import { Subagent } from "./extensions/subagent"
import { effectTable } from "./effects"
import { type Approvals, trustExtension } from "./extensions/trust"
import { baseSections, type RoleInput } from "./prompt"

// Architecture sections 2 and 16. This file is the only place that installs extensions and chooses
// a conversation's extensions. `pi-durable` applies hooks only for selected extensions, so a
// guard such as `Trust` holds only if every agent is built here.

export type BuildAgentInput = RoleInput & {
  model: ModelRef
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
  return [defineExtension({ name: BASE, sections: baseSections(input) }), Subagent, ...(input.testExtensions ?? [])]
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

/** DEV ONLY. The test model (architecture section 11.6) until per-user credentials (P4-02) land. */
export const DEV_MODEL: ModelRef = { provider: "opencode-go", modelId: "deepseek-v4.1-flash" }

/**
 * DEV ONLY. A `Models` that reads `OPENCODE_API_KEY` from the Worker's env and nothing else. The key
 * stays in this object and is never logged. `sessionId` must be stable per agent: OpenCode Go
 * answers 400 MissingSessionID without the `x-opencode-session` header (P0-05), and pi-durable
 * passes headers only through `settings.stream.headers`.
 */
export function devModels(apiKey: string | undefined, sessionId: string): { models: Models; settings: HarnessSettings } {
  const models = createModels({
    authContext: {
      env: async (name) => (name === "OPENCODE_API_KEY" ? apiKey || undefined : undefined),
      fileExists: async () => false,
    },
  })
  models.setProvider(opencodeGoProvider())
  return { models, settings: { stream: { headers: { "x-opencode-session": sessionId } } } }
}
