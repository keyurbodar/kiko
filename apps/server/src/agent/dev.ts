import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Harness } from "@earendil-works/pi-durable"
import type { Opened } from "@yuki/agent/host"
import type { Work } from "@yuki/agent/workers"
import { isWiped } from "@yuki/durable/wipe"
import type { AgentHome } from "../room/room-do"
import { DEV_CLASSIC_KEY, DEV_FAKE_KEY, DEV_INITIATIVE_KEY } from "./agent-do"

// The bodies never reach a production bundle: dev-guard loads this module only in a dev build.

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

// What a dev method needs from AgentDO. AgentDO exposes the Durable Object state and its own helpers here,
// so the bodies can live in this dev-only module.
export interface AgentDevHost {
  storage: DurableObjectStorage
  home(): AgentHome | null
  opened(): Promise<Opened>
  usageOf(harness: Harness): Promise<Usage>
  carried(): Promise<Usage>
  workers(): Work[]
}

export async function devInitiative(host: AgentDevHost): Promise<string | null> {
  if (await isWiped(host.storage)) throw new Error("this agent was deleted")
  return (await host.storage.get<string>(DEV_INITIATIVE_KEY)) ?? null
}

export async function devUsage(host: AgentDevHost): Promise<Usage> {
  if (await isWiped(host.storage)) throw new Error("this agent was deleted")
  if (!host.home()) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const { harness } = await host.opened()
  const now = await host.usageOf(harness)
  const carried = await host.carried()
  return { input: carried.input + now.input, output: carried.output + now.output, cacheRead: carried.cacheRead + now.cacheRead, cacheWrite: carried.cacheWrite + now.cacheWrite }
}

export async function devTrace(host: AgentDevHost): Promise<{ kind: string; tool?: string; chars: number; text?: string }[]> {
  if (await isWiped(host.storage)) throw new Error("this agent was deleted")
  if (!host.home()) return []
  const { root } = await host.opened()
  const view = await root.context(BACKGROUND_CONTEXT)
  return view.entries.map((e) => {
    const m = e.model?.[0] as { content?: string | { type: string; text?: string; name?: string; thinking?: string }[] } | undefined
    const parts = typeof m?.content === "string" ? [{ type: "text", text: m.content }] : (m?.content ?? [])
    const tool = parts.find((p) => p.type === "toolCall")?.name
    const text = parts.map((p) => p.text ?? "").join("").slice(0, 300)
    return { kind: e.kind, ...(tool ? { tool } : {}), chars: parts.reduce((n, p) => n + (p.text?.length ?? 0) + (p.thinking?.length ?? 0), 0), ...(text ? { text } : {}) }
  })
}

export async function devClassic(host: AgentDevHost): Promise<void> {
  await host.storage.put(DEV_CLASSIC_KEY, true)
}

export async function devFake(host: AgentDevHost): Promise<void> {
  await host.storage.put(DEV_FAKE_KEY, true)
}

export async function devWorkers(host: AgentDevHost): Promise<Work[]> {
  if (await isWiped(host.storage)) throw new Error("this agent was deleted")
  return host.workers()
}

export async function devSeed(host: AgentDevHost): Promise<void> {
  await host.storage.put("dev-seed", Date.now())
}
