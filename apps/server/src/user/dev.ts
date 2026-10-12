import type { ComposioConnection } from "../integrations/composio/connect"
import type { KernelConnection } from "../integrations/kernel/connect"
import type { InitiativeEngine } from "../initiative/engine"
import { loadUserDev } from "../lib/dev-guard"
import type { Reminders } from "./reminders"
import type { DevBrowserOp, DevInitiativeOp } from "./dev-impl"

export type { DevBrowserOp, DevInitiativeOp } from "./dev-impl"

// One guarded entry for the dev-only user methods. Each function reaches its body in dev-impl.ts through
// loadUserDev, so a production bundle carries neither the bodies nor a guard per function.
type DevUser = typeof import("./dev-impl")

const impl = (): Promise<DevUser> => loadUserDev()

export async function devSeen(sql: SqlStorage, ago: number): Promise<void> {
  return (await impl()).devSeen(sql, ago)
}

export async function devSetting(sql: SqlStorage, key: "memory_policy", value: string): Promise<void> {
  return (await impl()).devSetting(sql, key, value)
}

export async function devComposioSession(composio: () => ComposioConnection): Promise<string | null> {
  return (await impl()).devComposioSession(composio)
}

export async function devCaptureQueue(sql: SqlStorage): Promise<number> {
  return (await impl()).devCaptureQueue(sql)
}

export async function devDue(reminders: Reminders, id: string): Promise<void> {
  return (await impl()).devDue(reminders, id)
}

export async function devBrowser(kernel: () => KernelConnection, userId: string, op: DevBrowserOp): Promise<Record<string, unknown>> {
  return (await impl()).devBrowser(kernel, userId, op)
}

export async function devInitiative(engine: () => InitiativeEngine, reminders: Reminders, op: DevInitiativeOp): Promise<unknown> {
  return (await impl()).devInitiative(engine, reminders, op)
}
