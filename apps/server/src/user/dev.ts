import type { Mode } from "../integrations/kernel/client"
import type { ComposioConnection } from "../integrations/composio/connect"
import { type KernelConnection, profileName } from "../integrations/kernel/connect"
import type { InitiativeEngine } from "../initiative/engine"
import { devOnly } from "../lib/dev-guard"
import { setSetting } from "../lib/settings"
import type { Reminders } from "./reminders"
import { LAST_SEEN } from "./keys"

export async function devSeen(sql: SqlStorage, ago: number): Promise<void> {
  devOnly()
  setSetting(sql, LAST_SEEN, String(Date.now() - ago))
}

export async function devSetting(sql: SqlStorage, key: "memory_policy", value: string): Promise<void> {
  devOnly()
  if (key !== "memory_policy") throw new Error("not found")
  setSetting(sql, key, value)
}

export async function devComposioSession(composio: () => ComposioConnection): Promise<string | null> {
  devOnly()
  return composio().sessionId()
}

export async function devCaptureQueue(sql: SqlStorage): Promise<number> {
  devOnly()
  return sql.exec<{ n: number }>("SELECT count(*) AS n FROM capture_queue").one().n
}

export async function devDue(reminders: Reminders, id: string): Promise<void> {
  devOnly()
  await reminders.makeDue(id)
}

export type DevBrowserOp = { action: "lease" | "touch" | "dead" | "age" | "reap" | "switch" | "state"; agentId?: string; mode?: Mode; ms?: number }

// DEVELOPMENT ONLY: `verify kernel` drives the lease and the reaper without waiting minutes.
export async function devBrowser(kernel: () => KernelConnection, userId: string, op: DevBrowserOp): Promise<Record<string, unknown>> {
  devOnly()
  const k = kernel()
  if (op.action === "lease") {
    const { cdpUrl: _, ...rest } = await k.leaseFor(op.agentId)
    return { ...rest, sessionId: k.sessionId() }
  }
  if (op.action === "touch") return { ok: k.touch(op.agentId) }
  if (op.action === "dead") {
    const gone = await k.lease.killForDev()
    if (gone) await k.markDead(op.agentId, gone)
  }
  if (op.action === "age") k.age(op.ms ?? 0)
  if (op.action === "reap") await k.reap()
  if (["dead", "age", "reap"].includes(op.action)) return { sessionId: k.sessionId() }
  if (op.action === "switch") {
    const { cdpUrl: _, ...rest } = await k.lease.switchMode(op.mode === "headful" ? "headful" : "headless")
    return { ...rest, sessionId: k.sessionId() }
  }
  return { sessionId: k.sessionId(), status: k.status(), profile: await profileName(userId) }
}

export type DevInitiativeOp = { action: "age"; ms: number } | { action: "rhythm"; mode: "now" | "clear" } | { action: "pass" } | { action: "state" }

// Development only (section 26.8): a day of initiative in seconds.
export async function devInitiative(engine: () => InitiativeEngine, reminders: Reminders, op: DevInitiativeOp): Promise<unknown> {
  devOnly()
  const e = engine()
  if (op.action === "rhythm") {
    e.devRhythm(op.mode)
    return { at: await e.arm() }
  }
  if (op.action === "pass") return e.pass()
  if (op.action === "state") return e.devState()
  e.devAge(op.ms)
  // A reminder an agent set for itself ages with the clock, and fires once the aging reaches it.
  await reminders.devAge(op.ms)
  return { at: await e.arm() }
}
