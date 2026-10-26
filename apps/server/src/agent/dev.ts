import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Harness } from "@earendil-works/pi-durable"
import type { Opened } from "@kiko/agent/host"
import type { Work } from "@kiko/agent/workers"
import type { AgentHome } from "../room/room-do"
import { DEV_FAKE_KEY } from "./agent-do"

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface AgentDevHost {
  storage: DurableObjectStorage
  home(): AgentHome | null
  opened(): Promise<Opened>
  usageOf(harness: Harness): Promise<Usage>
  carried(): Promise<Usage>
  workers(): Work[]
}

export async function devUsage(host: AgentDevHost): Promise<Usage> {
  if (!host.home()) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const { harness } = await host.opened()
  const now = await host.usageOf(harness)
  const carried = await host.carried()
  return {
    input: carried.input + now.input,
    output: carried.output + now.output,
    cacheRead: carried.cacheRead + now.cacheRead,
    cacheWrite: carried.cacheWrite + now.cacheWrite,
  }
}

type TracePart = { type: string; text?: string; name?: string; thinking?: string; arguments?: unknown }
type TraceMessage = { role?: string; content?: string | TracePart[]; toolName?: string; isError?: boolean }

export type TraceLine = { kind: string; role?: string; text?: string; calls?: string[]; tool?: string; error?: boolean }

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

function traceLine(kind: string, m: TraceMessage | undefined): TraceLine {
  const parts: TracePart[] = typeof m?.content === "string" ? [{ type: "text", text: m.content }] : (m?.content ?? [])
  const text = clip(parts.map((p) => p.text ?? "").join(""), 4000)
  const calls = parts
    .filter((p) => p.type === "toolCall")
    .map((p) => `${p.name}(${clip(JSON.stringify(p.arguments ?? {}), 400)})`)
  return {
    kind,
    ...(m?.role ? { role: m.role } : {}),
    ...(text ? { text } : {}),
    ...(calls.length ? { calls } : {}),
    ...(m?.toolName ? { tool: m.toolName } : {}),
    ...(m?.isError ? { error: true } : {}),
  }
}

export async function devTrace(host: AgentDevHost): Promise<TraceLine[]> {
  if (!host.home()) return []
  const { root } = await host.opened()
  const view = await root.context(BACKGROUND_CONTEXT)
  return view.entries.flatMap((e) => (e.model ?? []).map((m) => traceLine(e.kind, m as TraceMessage)))
}

export async function devFake(host: AgentDevHost): Promise<void> {
  await host.storage.put(DEV_FAKE_KEY, true)
}

export async function devWorkers(host: AgentDevHost): Promise<Work[]> {
  return host.workers()
}
