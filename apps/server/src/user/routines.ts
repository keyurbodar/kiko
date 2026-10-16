import type { Trigger, WebhookMatch } from "@kiko/protocol"
import { type Reminder, ReminderError } from "./reminders"

export type RoomRoutine = { id: string; target: string; trigger: Extract<Trigger, { on: "message" }> }

export const roomRoutine = (r: Reminder): RoomRoutine => ({ id: r.id, target: r.target, trigger: r.trigger as RoomRoutine["trigger"] })

export type RoutineResult = { ok: true; routine: Reminder; token?: string } | { ok: false; error: string }

export async function routineResult(run: () => Promise<{ routine: Reminder; token?: string } | null>): Promise<RoutineResult> {
  try {
    const out = await run()
    return out ? { ok: true, ...out } : { ok: false, error: "no such routine" }
  } catch (e) {
    if (e instanceof ReminderError) return { ok: false, error: e.message }
    throw e
  }
}

function at(value: unknown, path: string): unknown {
  let cur = value
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

export function matchWebhook(match: readonly WebhookMatch[], body: unknown): boolean {
  return match.every((m) => {
    const v = at(body, m.path)
    if (v === undefined) return false
    if (m.equals !== undefined && v !== m.equals) return false
    if (m.contains !== undefined && !(typeof v === "string" ? v : JSON.stringify(v)).toLowerCase().includes(m.contains.toLowerCase())) return false
    return true
  })
}
