import type { Alarms } from "./alarm"

export const HELLO_TIMEOUT_MS = 5_000
export const HELLO_WAKEUP = "hello"
export const HELLO_TIMEOUT_CODE = 4408
export const HELLO_TIMEOUT_REASON = "no hello within 5 seconds"

type Waiting = { ready: boolean; helloBy?: number }

const waiting = (ws: WebSocket) => ws.deserializeAttachment() as Waiting | null

export const helloBy = (now = Date.now()) => now + HELLO_TIMEOUT_MS

export async function enforceHello(ctx: DurableObjectState, alarms: Alarms, now = Date.now()): Promise<void> {
  let next = Number.POSITIVE_INFINITY
  for (const ws of ctx.getWebSockets()) {
    const a = waiting(ws)
    if (!a || a.ready || a.helloBy === undefined) continue
    if (a.helloBy > now) {
      next = Math.min(next, a.helloBy)
      continue
    }
    try {
      ws.close(HELLO_TIMEOUT_CODE, HELLO_TIMEOUT_REASON)
    } catch {
    }
  }
  if (next === Number.POSITIVE_INFINITY) await alarms.clearWakeup(HELLO_WAKEUP)
  else await alarms.setWakeup(HELLO_WAKEUP, next)
}
