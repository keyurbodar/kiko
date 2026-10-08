import type { Alarms } from "./alarm"

// Architecture section 23. A socket must say `hello` within `HELLO_TIMEOUT_MS` of its upgrade, or
// the object closes it with a reason. The deadline lives in the socket's attachment, so it survives
// hibernation, and one wakeup points at the earliest deadline. No `setTimeout`: it would not survive
// eviction and would block hibernation.

export const HELLO_TIMEOUT_MS = 5_000
export const HELLO_WAKEUP = "hello"
/** Close code for a socket that never said hello. 4408 mirrors HTTP 408. */
export const HELLO_TIMEOUT_CODE = 4408
export const HELLO_TIMEOUT_REASON = "no hello within 5 seconds"

/** The attachment fields this file reads. Both sockets store more. */
type Waiting = { ready: boolean; helloBy?: number }

const waiting = (ws: WebSocket) => ws.deserializeAttachment() as Waiting | null

/** The deadline to store in a new socket's attachment. */
export const helloBy = (now = Date.now()) => now + HELLO_TIMEOUT_MS

/**
 * Closes every socket past its hello deadline and points the hello wakeup at the next one. Call it
 * after accepting a socket and when the hello wakeup fires.
 */
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
      // Already closed.
    }
  }
  if (next === Number.POSITIVE_INFINITY) await alarms.clearWakeup(HELLO_WAKEUP)
  else await alarms.setWakeup(HELLO_WAKEUP, next)
}
