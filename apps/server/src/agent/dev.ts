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

export async function devTrace(
  host: AgentDevHost,
): Promise<{ kind: string; tool?: string; chars: number; text?: string }[]> {
  if (!host.home()) return []
  const { root } = await host.opened()
  const view = await root.context(BACKGROUND_CONTEXT)
  return view.entries.map((e) => {
    const m = e.model?.[0] as
      | { content?: string | { type: string; text?: string; name?: string; thinking?: string }[] }
      | undefined
    const parts = typeof m?.content === "string" ? [{ type: "text", text: m.content }] : (m?.content ?? [])
    const tool = parts.find((p) => p.type === "toolCall")?.name
    const text = parts
      .map((p) => p.text ?? "")
      .join("")
      .slice(0, 300)
    return {
      kind: e.kind,
      ...(tool ? { tool } : {}),
      chars: parts.reduce((n, p) => n + (p.text?.length ?? 0) + (p.thinking?.length ?? 0), 0),
      ...(text ? { text } : {}),
    }
  })
}

export async function devFake(host: AgentDevHost): Promise<void> {
  await host.storage.put(DEV_FAKE_KEY, true)
}

export async function devWorkers(host: AgentDevHost): Promise<Work[]> {
  return host.workers()
}
