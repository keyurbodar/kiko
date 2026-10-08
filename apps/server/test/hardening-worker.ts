import { DurableObject } from "cloudflare:workers"
import type { Envelope } from "@kiko/protocol"
import { Inbox } from "../src/agent/inbox"
import { createAlarms } from "@kiko/durable/alarm"

// The real inbox and wakeup helpers in workerd, with a clock the test sets. `restart` swaps in a
// new `Inbox`, the way a new process after a crash would construct one.
export class H extends DurableObject {
  clock = 1_000_000
  inbox = new Inbox(this.ctx.storage, () => this.clock)
  alarms = createAlarms(this.ctx)

  async alarm() {}

  async fetch(req: Request) {
    const b = (await req.json()) as any
    switch (b.op) {
      case "admit":
        return Response.json(this.inbox.admit(b.envelopes as Envelope[], b.brief ?? ""))
      case "claim":
        if (b.now !== undefined) this.clock = b.now
        return Response.json(await this.inbox.claim())
      case "submitted":
        return Response.json(this.inbox.submitted(b.requestId))
      case "restart":
        this.inbox = new Inbox(this.ctx.storage, () => this.clock)
        return Response.json(true)
      case "counts":
        return Response.json(this.inbox.counts())
      case "wakeups": {
        // Sets `count` new keys far in the future; returns how many were stored before the first refusal.
        let stored = 0
        try {
          for (let i = 0; i < b.count; i++) {
            await this.alarms.setWakeup(`${b.prefix}${i}`, 5e12 + i)
            stored++
          }
          return Response.json({ stored, error: null })
        } catch (error) {
          return Response.json({ stored, error: error instanceof Error ? error.name : String(error) })
        }
      }
      case "move":
        await this.alarms.setWakeup(b.key, b.at)
        return Response.json(true)
      case "due":
        return Response.json({ keys: await this.alarms.dueWakeups(b.now), history: this.alarms.history() })
    }
    return new Response("unknown op", { status: 400 })
  }
}

export default { fetch: () => new Response("ok") }
