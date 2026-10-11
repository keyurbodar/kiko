import type { Context } from "@earendil-works/chord"
import type { ToolCall } from "@earendil-works/pi-ai"
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation"
import {
  type Agent,
  defineExtension,
  defineTool,
  type Extension,
  GenerationTask,
  hook,
  type HookApi,
  type HookRegistration,
  type PromptSection,
  section,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolHooks,
  type ToolRegistration,
  ToolTask,
  type Wrap,
  wrapSection,
  wrapTool,
} from "@earendil-works/pi-durable"
import type { ExtensionBundle, ExtensionManifest, ExtensionStateScope } from "./manifest"
import { declareEffect, type Effect, effectOf } from "@yuki/agent/effects"
import { type Bridge, ScriptError, ScriptVM, type Target } from "./vm"

export type ScriptPorts = {
  wasm: () => WebAssembly.Module
  state: (extension: string, scope: ExtensionStateScope, op: "get" | "set" | "delete" | "list", key: string, value?: unknown) => Promise<unknown>
  fetch: (extension: string, request: GuestRequest) => Promise<GuestResponse>
  env: () => { agent: string; room?: string; timezone: string }
  report: (extension: string, hash: string, error: string) => void
}

export type GuestRequest = { url: string; method?: string; headers?: Record<string, string>; body?: string; json?: unknown }
export type GuestResponse = { status: number; headers: Record<string, string>; text: string; json?: unknown; truncated?: boolean }

export type Installed = { name: string; hash: string; bundle: ExtensionBundle }

const RANK: Record<Effect, Effect[]> = {
  read: ["read"],
  write: ["read", "write"],
  message: ["read", "message"],
  external: ["read", "write", "message", "external"],
}

const isPlainGet = (init: { method?: string; body?: unknown; json?: unknown } | undefined) =>
  (init?.method ?? "GET").toUpperCase() === "GET" && init?.body === undefined && init?.json === undefined

export const mayCall = (caller: Effect, callee: Effect) => RANK[caller].includes(callee)

export class VmPool {
  private readonly vms = new Map<string, Promise<ScriptVM>>()

  constructor(private readonly wasm: () => WebAssembly.Module) {}

  get(installed: Installed): Promise<ScriptVM> {
    const cached = this.vms.get(installed.hash)
    if (cached) {
      return cached.then(
        (vm) => (vm.unusable ? this.start(installed) : vm),
        () => this.start(installed),
      )
    }
    return this.start(installed)
  }

  private start(installed: Installed): Promise<ScriptVM> {
    const starting = ScriptVM.create(installed.bundle, this.wasm())
    this.vms.set(installed.hash, starting)
    return starting
  }

  release(): void {
    this.retain(new Set())
  }

  retain(keep: ReadonlySet<string>): void {
    for (const [hash, vm] of this.vms) {
      if (keep.has(hash)) continue
      this.vms.delete(hash)
      void vm.then((v) => v.retire()).catch(() => {})
    }
  }
}

const text = (t: string) => [{ type: "text" as const, text: t }]

function asResult(value: unknown, logs: readonly string[]): ToolExecutionResult {
  const body = value === undefined || value === null ? "(no output)" : typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return logs.length ? { content: text(body), details: { logs: [...logs] } } : { content: text(body) }
}

const resultText = (r: ToolExecutionResult) => (r.content ?? []).flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n")

async function callThroughHooks(agent: Agent, tool: ToolRegistration, call: ToolCall, api: ToolExecutionApi, context: Context): Promise<ToolExecutionResult> {
  const hooks = agent.extensions.flatMap((e) => (e.hooks ?? []).filter((h) => h.task === ToolTask.definition.name).map((h) => h.handlers as Partial<ToolHooks>))
  let args = call.arguments
  for (const h of hooks) {
    const decision = await h.beforeTool?.({ ...call, arguments: args }, api, context)
    if (decision?.block !== undefined) throw new Error(decision.block)
    if (decision?.arguments !== undefined) args = decision.arguments
  }
  const final = { ...call, arguments: validateToolArguments(tool, { ...call, arguments: args }) }
  let result = await tool.execute(final.arguments as never, api as never, context)
  for (const h of hooks) result = (await h.afterTool?.(final, result, api, context)) ?? result
  return result
}

const MAX_LOGS = 50
const MAX_CALL_DEPTH = 4
const callDepth = new WeakMap<object, number>()
const MAX_CONTINUES = 3

type BridgeContext = { name: string; manifest: ExtensionManifest; ports: Pick<ScriptPorts, "state" | "fetch"> }

export type CallPort = {
  effectOf: (tool: string) => Promise<Effect | undefined>
  run: (tool: string, args: Record<string, unknown>) => Promise<string>
}

const stateOp = async ({ name, manifest, ports }: BridgeContext, op: string, payload: unknown[], readOnlyFor?: string): Promise<unknown> => {
  if (!manifest.state) throw new Error(`yuki.state needs "state" in extension.json`)
  const verb = op.slice("state.".length) as "get" | "set" | "delete" | "list"
  if (readOnlyFor && verb !== "get" && verb !== "list") throw new Error(`${readOnlyFor} can only read yuki.state`)
  return ports.state(name, manifest.state, verb, String(payload[0] ?? ""), payload[1])
}

type ToolBridgeInput = BridgeContext & {
  effect: Effect
  self: string
  logs: string[]
  calls: CallPort
  next?: (args: Record<string, unknown>) => Promise<unknown>
}

export function makeToolBridge(input: ToolBridgeInput): Bridge {
  const { name, manifest, ports, effect, self, logs, calls, next } = input
  const allowed = new Set(manifest.calls ?? [])
  return async (op, payload) => {
    if (op === "log") {
      if (logs.length < MAX_LOGS) logs.push(((payload[0] as string[]) ?? []).join(" ").slice(0, 500))
      return undefined
    }
    if (op.startsWith("state.")) return stateOp(input, op, payload, effect === "read" ? `a "read" tool` : undefined)
    if (op === "next") {
      if (!next) throw new Error("yuki.next only works in a tool wrap")
      return next((payload[0] ?? {}) as Record<string, unknown>)
    }
    if (op === "fetch") {
      const [url, init] = payload as [string, Omit<GuestRequest, "url">]
      if (effect !== "external" && !isPlainGet(init)) throw new Error(`only a GET without a body works in a "${effect}" tool; ${self} needs "external" to send anything`)
      return ports.fetch(name, { ...(init ?? {}), url })
    }
    if (op === "call") {
      const [tool, args] = payload as [string, Record<string, unknown>]
      if (!allowed.has(tool)) throw new Error(`${tool} is not in "calls" in extension.json`)
      if (tool === self) throw new Error(`${self} cannot call itself`)
      const declared = await calls.effectOf(tool)
      if (!declared) throw new Error(`this agent has no tool ${tool}`)
      if (!mayCall(effect, declared)) throw new Error(`${self} is "${effect}" and cannot call ${tool}, which is "${declared}"`)
      return calls.run(tool, args ?? {})
    }
    throw new Error(`yuki.${op} is not available`)
  }
}

export const makeQuietBridge = (ctx: BridgeContext, where: string, readOnly: boolean): Bridge => async (op, payload) => {
  if (op === "log") return undefined
  if (op.startsWith("state.")) return stateOp(ctx, op, payload, readOnly ? where : undefined)
  throw new Error(`${where} can only use yuki.state and yuki.log`)
}

export function compileExtension(installed: Installed, pool: VmPool, ports: ScriptPorts): Extension {
  const { name, hash, bundle } = installed
  const m: ExtensionManifest = bundle.manifest
  const reported = new Set<string>()

  const report = (error: string) => {
    if (reported.has(error)) return
    reported.add(error)
    ports.report(name, hash, error)
  }

  const envFor = (extra: Record<string, unknown> = {}) => ({ ...ports.env(), extension: name, version: m.version, ...extra })

  const run = async (target: Target, args: unknown[], env: Record<string, unknown>, bridge: Bridge): Promise<unknown> => {
    let vm: ScriptVM
    try {
      vm = await pool.get(installed)
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      report(`failed to load: ${why}`)
      throw new ScriptError(`extension ${name} failed to load: ${why}`)
    }
    return vm.invoke(target, args, env, bridge)
  }

  const toolBridge = (effect: Effect, self: string, api: ToolExecutionApi, context: Context, logs: string[], next?: (args: Record<string, unknown>) => Promise<unknown>): Bridge =>
    makeToolBridge({ name, manifest: m, ports, effect, self, logs, next, calls: callPort(self, effect, api, context) })

  const quietBridge = (where: string, readOnly: boolean): Bridge => makeQuietBridge({ name, manifest: m, ports }, where, readOnly)

  const callPort = (self: string, effect: Effect, api: ToolExecutionApi, context: Context): CallPort => ({
    effectOf: async (tool) => {
      const callee = (await api.agent(context)).tools.find((t) => t.name === tool)
      return callee ? (effectOf(callee) ?? "external") : undefined
    },
    run: async (tool, args) => {
      const agent = await api.agent(context)
      const callee = agent.tools.find((t) => t.name === tool)
      if (!callee) throw new Error(`this agent has no tool ${tool}`)
      const call: ToolCall = { type: "toolCall", id: `${api.callId}:${tool}`, name: tool, arguments: args as never }
      const depth = callDepth.get(api) ?? 0
      if (depth >= MAX_CALL_DEPTH) throw new Error(`calls nest deeper than ${MAX_CALL_DEPTH}: ${self} called ${tool}`)
      callDepth.set(api, depth + 1)
      const result = await callThroughHooks(agent, callee, { ...call, arguments: validateToolArguments(callee, call) as never }, api, context).finally(() => callDepth.set(api, depth))
      const out = resultText(result)
      if (result.isError) throw new Error(out || `${tool} failed`)
      return out
    },
  })

  const tools: ToolRegistration[] = Object.entries(m.tools ?? {}).map(([toolName, t]) =>
    declareEffect(
      t.effect as Effect,
      defineTool({
        name: toolName,
        description: t.description,
        parameters: (t.parameters ?? { type: "object", properties: {} }) as never,
        replay: t.effect === "read" ? "safe" : "unsafe",
        execute: async (args, api, context) => {
          const logs: string[] = []
          try {
            const env = envFor({ tool: toolName, callId: `${api.conversationId}:${api.callId}` })
            const value = await run({ group: "tools", name: toolName }, [args ?? {}], env, toolBridge(t.effect as Effect, toolName, api, context, logs))
            return asResult(value, logs)
          } catch (e) {
            const why = e instanceof Error ? e.message : String(e)
            return { content: text(`${toolName} failed: ${why}`), isError: true, ...(logs.length ? { details: { logs } } : {}) }
          }
        },
      }),
    ),
  )

  const sections: PromptSection[] = Object.entries(m.sections ?? {}).map(([id, s]) => {
    const key = sectionKey(name, id)
    if (s.text !== undefined) {
      const fixed = s.text
      return section(key, () => fixed)
    }
    return section(key, async () => {
      try {
        const out = await run({ group: "sections", name: id }, [], envFor({ section: id }), quietBridge(`section ${id}`, true))
        return typeof out === "string" && out.trim() ? out : undefined
      } catch (e) {
        report(`section ${id}: ${e instanceof Error ? e.message : String(e)}`)
        return undefined
      }
    })
  })

  const wants = new Set(m.hooks ?? [])
  const hooks: HookRegistration[] = []
  const quiet = async (hookName: string, args: unknown[]): Promise<unknown> => {
    try {
      return await run({ group: "hooks", name: hookName }, args, envFor({ hook: hookName }), quietBridge(`hook ${hookName}`, false))
    } catch (e) {
      report(`hook ${hookName}: ${e instanceof Error ? e.message : String(e)}`)
      return undefined
    }
  }
  if (wants.has("beforeTool") || wants.has("afterTool")) {
    hooks.push(
      hook(ToolTask, {
        ...(wants.has("beforeTool")
          ? {
              beforeTool: async (call) => {
                const out = (await quiet("beforeTool", [{ name: call.name, arguments: call.arguments }])) as { block?: unknown; arguments?: unknown } | undefined
                if (!out || typeof out !== "object") return undefined
                if (typeof out.block === "string" && out.block.trim()) return { block: `${out.block} (extension ${name})` }
                if (out.arguments && typeof out.arguments === "object" && !Array.isArray(out.arguments)) return { arguments: out.arguments as Record<string, never> }
                return undefined
              },
            }
          : {}),
        ...(wants.has("afterTool")
          ? {
              afterTool: async (call, result) => {
                const out = await quiet("afterTool", [{ name: call.name, arguments: call.arguments }, { text: resultText(result), isError: result.isError === true }])
                if (typeof out !== "string") return undefined
                const others = (result.content ?? []).filter((p) => p.type !== "text")
                return { ...result, content: [...text(out), ...others] }
              },
            }
          : {}),
      }),
    )
  }
  if (wants.has("onYield") || wants.has("afterResponse")) {
    const continues = new Map<string, number>()
    const answerText = (message: { content: readonly { type: string; text?: string }[] }) =>
      message.content.flatMap((p) => (p.type === "text" && p.text ? [p.text] : [])).join("\n")
    hooks.push(
      hook(GenerationTask, {
        ...(wants.has("onYield")
          ? {
              onYield: async (answer, api: HookApi) => {
                const key = String(api.conversationId)
                const used = continues.get(key) ?? 0
                const out = used >= MAX_CONTINUES ? undefined : ((await quiet("onYield", [{ text: answerText(answer) }])) as { continue?: unknown } | undefined)
                if (!out || typeof out.continue !== "string" || !out.continue.trim()) {
                  continues.delete(key)
                  return undefined
                }
                continues.set(key, used + 1)
                return { continue: out.continue }
              },
            }
          : {}),
        ...(wants.has("afterResponse")
          ? {
              afterResponse: async (message) => {
                await quiet("afterResponse", [{ text: answerText(message), stopReason: message.stopReason }])
              },
            }
          : {}),
      }),
    )
  }

  const wraps: Wrap[] = []
  for (const target of m.wraps?.tools ?? []) {
    wraps.push(
      wrapTool({ name: target } as ToolRegistration, (original) => ({
        ...original,
        execute: async (args, api, context) => {
          const logs: string[] = []
          const effect = effectOf(original) ?? "external"
          const next = async (nextArgs: Record<string, unknown>) => {
            const r = await original.execute(nextArgs as never, api, context)
            const out = resultText(r)
            if (r.isError) throw new Error(out || `${target} failed`)
            return out
          }
          try {
            const env = envFor({ wraps: target, callId: `${api.conversationId}:${api.callId}` })
            const value = await run({ group: "wrapTools", name: target }, [args ?? {}], env, toolBridge(effect, target, api, context, logs, next))
            return asResult(value, logs)
          } catch (e) {
            return { content: text(`${target} failed: ${e instanceof Error ? e.message : String(e)}`), isError: true }
          }
        },
      })),
    )
  }
  for (const key of m.wraps?.sections ?? []) {
    wraps.push(
      wrapSection(key, (original) => ({
        ...original,
        render: async (input, context) => {
          const before = await original.render(input, context)
          try {
            const out = await run({ group: "wrapSections", name: key }, [before ?? null], envFor({ section: key }), quietBridge(`section wrap ${key}`, true))
            return typeof out === "string" ? out : before
          } catch (e) {
            report(`section wrap ${key}: ${e instanceof Error ? e.message : String(e)}`)
            return before
          }
        },
      })),
    )
  }

  return defineExtension({ name: extensionName(name), tools, sections, hooks, wraps })
}

// pi-durable keys sections by this string across every extension, so a joiner neither side can contain keeps two extensions from sharing a key.
const sectionKey = (extension: string, id: string) => `${extension}_${id}`

export const extensionName = (name: string) => `ext:${name}`
