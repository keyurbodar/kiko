import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Harness, type Storage } from "@earendil-works/pi-durable"
import { JournalStorage } from "@kiko/agent/journal"
import type { AgentSetup } from "@kiko/agent/host"
import type { AuthResult, Models } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { providers } from "../models/catalog"
import {
  type AgentChange,
  createRegistry,
  type Extension,
  hook,
  ToolTask,
  type HarnessSettings,
  type ModelRef,
  type Registry,
  type RegistryReader,
} from "@earendil-works/pi-durable"
import { workExtensions } from "./extensions/work"
import { withTextToolCalls } from "./tool-markup"
import { withDraft2020Tools } from "./tool-schema"
import { RepeatGuard } from "./repeats"
import type { Workers } from "@kiko/agent/workers"
import { effectTable } from "@kiko/agent/effects"
import { type FilesOptions, filesExtension } from "./extensions/files"
import { type MemoryPort, memoryExtensions } from "@kiko/memory/tools"
import { type WorkspacePort, workspaceExtension } from "./extensions/workspace"
import { type MessagingPort, messagingExtension } from "./extensions/messaging"
import { type RoutinesPort, routinesExtension } from "./extensions/routines"
import { type AppsDeps, appsExtension } from "./extensions/apps"
import { type RecipesPort, skillsExtension } from "./extensions/skills"
import { selfExtension } from "./extensions/self"
import { type GroupsPort, groupsExtension } from "./extensions/chief"
import { presenceExtension, type StepsPort } from "./extensions/presence"
import { composioDescribe } from "../integrations/composio/step"
import type { RoomFs, SoulPort } from "../files/room-fs"
import type { ComposioCall, ComposioTool } from "../integrations/composio/client"
import { composioExtension } from "../integrations/composio/tools"
import { connectAppExtension } from "../integrations/composio/connect-tool"
import { type BrowserToolDeps, browserExtension, browserInfoExtension } from "./browser/tools"
import { type ComputerToolDeps, computerExtension, computerInfoExtension } from "./computer/tools"
import { promptExtensions, type RoleInput } from "./prompt"
import { forRole } from "./roles"
import { count } from "../lib/dev-guard"
import type { ThinkingLevel } from "@kiko/protocol"
import { thinkingFor } from "./thinking"
import { RETRY, withRetryAfter } from "./retry"

export type BuildAgentInput = RoleInput & {
  model?: ModelRef
  thinkingLevel?: ThinkingLevel
  files?: Omit<FilesOptions, "touched"> & { fs: RoomFs }
  soul?: SoulPort
  runStamp?: () => number
  groups?: GroupsPort
  presence?: StepsPort
  runId?: () => string | null
  memory?: MemoryPort
  workspace?: WorkspacePort
  composio?: { tools: readonly ComposioTool[]; call: ComposioCall; resolve?: (app: string) => Promise<string | null> }
  browser?: BrowserToolDeps
  computers?: ComputerToolDeps
  routines?: { port: () => RoutinesPort | null }
  apps?: AppsDeps["apps"]
  recipes?: RecipesPort
  messaging?: () => MessagingPort | null
  testExtensions?: readonly Extension[]
  work?: Workers
}

export type BuiltAgent = {
  registry: Registry
  agent: AgentChange
}

const REPEATS = "repeats"
const journals = new WeakMap<RegistryReader, JournalStorage>()

function extensionsFor(input: BuildAgentInput, all: () => readonly Extension[]): Extension[] {
  return [
    ...promptExtensions(input),
    ...(input.files && input.soul ? [selfExtension(input.files.fs, input.soul, input.runStamp)] : []),
    ...(input.memory ? memoryExtensions(input.memory) : []),
    ...(input.files
      ? [
          filesExtension({
            acceptsImages: input.files.acceptsImages,
            touched: (conversationId, paths) => input.work?.touched(conversationId, paths),
          }),
        ]
      : []),
    skillsExtension(input.files?.fs, input.runStamp, input.recipes),
    ...(input.workspace ? [workspaceExtension(input.workspace, input.lead)] : []),
    ...(input.messaging ? [messagingExtension(input.messaging)] : []),
    ...(input.groups ? [groupsExtension(input.groups)] : []),
    ...(input.presence
      ? [
          presenceExtension({
            ...input.presence,
            ...(input.composio?.tools.length ? { describe: composioDescribe(input.composio.tools) } : {}),
          }),
        ]
      : []),
    ...(input.routines ? [routinesExtension(input.routines.port)] : []),
    ...(input.apps && input.files ? [appsExtension({ apps: input.apps, fs: input.files.fs })] : []),
    ...(input.composio?.tools.length
      ? [composioExtension(input.composio.tools, input.composio.call, input.files?.fs)]
      : []),
    ...(input.composio?.tools.length
      ? connectAppExtension(input.composio.tools, input.composio.call, input.composio.resolve)
      : []),
    ...(input.browser ? [browserExtension(input.browser), browserInfoExtension(input.browser)] : []),
    ...(input.computers ? [computerExtension(input.computers), computerInfoExtension(input.computers)] : []),
    ...(input.work ? workExtensions(input.work, all, input.runId) : []),
    ...(input.testExtensions ?? []),
  ]
}

export function buildAgent(input: BuildAgentInput): BuiltAgent {
  const registry = createRegistry()
  let builtins: Extension[] = []
  const extensions = extensionsFor(input, () => builtins)
  const effects = effectTable(extensions)
  const repeats = new RepeatGuard(input.runId)
  const guard = defineExtension({
    name: REPEATS,
    hooks: [
      hook(ToolTask, {
        beforeTool: (call, api) => {
          if (call.parent) return undefined
          const refusal = repeats.check(api.conversationId, call, effects.get(call.name))
          return refusal ? { block: refusal } : undefined
        },
      }),
    ],
  })
  builtins = extensions.map((extension) => ({
    ...extension,
    tools: extension.tools?.map((tool) => {
      const effect = effects.get(tool.name)
      if (effect !== "external" && effect !== "write") return tool
      return {
        ...tool,
        ...(effect === "write" ? { executionMode: "sequential" as const } : {}),
        execute: async (args, api, context) => {
          journals.get(registry)?.flush()
          return tool.execute(args, api, context)
        },
      } satisfies typeof tool
    }),
  }))
  builtins.push(guard)
  for (const extension of builtins) registry.install(extension)
  return {
    registry,
    agent: {
      ...(input.model ? { model: input.model } : {}),
      thinkingLevel: input.thinkingLevel ?? (input.model ? thinkingFor(input.model) : "off"),
      extensions: forRole(builtins, "talker"),
    },
  }
}

const NO_CUSTOM_FETCH = new Set(["google-generative-ai", "google-vertex"])

function timed<S extends { result(): Promise<unknown> }>(modelId: string, stream: S, reasoning?: string): S {
  const t = performance.now()
  count("model.turns")
  count(`model.id.${modelId}`)
  count(`model.reasoning.${reasoning ?? "off"}`)
  void stream.result().then(
    () => count("model.ms", Math.round(performance.now() - t)),
    () => {},
  )
  return stream
}

function unanchored<M extends { compat?: object }>(model: M): M {
  return { ...model, compat: { ...model.compat, supportsMidConvoToolAdditions: false } }
}

export type RunAuth = (provider: string) => Promise<AuthResult | undefined>

export const RUN_SETTINGS: HarnessSettings = { toolExecution: "parallel", retry: { ...RETRY } }

export function userModels(
  auth: RunAuth,
  sessionId: string,
  egress?: typeof fetch,
  directCall?: () => void,
): { models: Models; settings: HarnessSettings } {
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } })
  for (const provider of providers()) {
    const through = egress ? withRetryAfter(egress) : undefined
    const via = (model: { api: string }, options: object | undefined) => {
      if (through && !NO_CUSTOM_FETCH.has(model.api)) return { ...options, fetch: through }
      directCall?.()
      return options
    }
    const classify = provider.classify
    const fetchDeferred = provider.fetchDeferred
    const cancelDeferred = provider.cancelDeferred
    const generateImages = provider.generateImages
    const routed = {
      ...(classify
        ? { classify: ((model, context, options) => classify(model, context, via(model, options))) as typeof classify }
        : {}),
      ...(fetchDeferred
        ? {
            fetchDeferred: ((model, handle, options) =>
              fetchDeferred(model, handle, via(model, options))) as typeof fetchDeferred,
          }
        : {}),
      ...(cancelDeferred
        ? {
            cancelDeferred: ((model, handle, options) =>
              cancelDeferred(model, handle, via(model, options))) as typeof cancelDeferred,
          }
        : {}),
      ...(generateImages
        ? {
            generateImages: ((model, context, options) =>
              generateImages(model, context, via(model, options))) as typeof generateImages,
          }
        : {}),
      stream: ((model, context, options) =>
        timed(
          model.id,
          withTextToolCalls(provider.stream as never)(
            unanchored(model),
            withDraft2020Tools(context) as never,
            via(model, options) as never,
          ),
        )) as typeof provider.stream,
      streamSimple: ((model, context, options) =>
        timed(
          model.id,
          withTextToolCalls(provider.streamSimple)(
            unanchored(model),
            withDraft2020Tools(context),
            via(model, options) as never,
          ),
          options?.reasoning,
        )) as typeof provider.streamSimple,
    }
    models.setProvider({
      ...provider,
      ...routed,
      auth: { apiKey: { name: provider.name, resolve: () => auth(provider.id) } },
    })
  }
  return { models, settings: { ...RUN_SETTINGS, stream: { headers: { "x-opencode-session": sessionId } } } }
}

export function openAgentHarness(storage: Storage, setup: AgentSetup): Promise<Harness> {
  if (storage instanceof JournalStorage) journals.set(setup.registry, storage)
  const env = setup.env
  return Harness.open(
    storage,
    {
      models: setup.models,
      registry: setup.registry,
      settings: setup.settings,
      ...(env ? { env: (target) => env(target.conversationId) } : {}),
    },
    BACKGROUND_CONTEXT,
  )
}
