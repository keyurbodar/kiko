import { DurableObject } from "cloudflare:workers"
import { ALARM_STEPS, createAlarms } from "@kiko/durable/alarm"
import { migrate } from "@kiko/durable/migrate"

export class H extends DurableObject {
  clock = 1_000_000
  alarms = createAlarms(this.ctx)

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    migrate(ctx.storage, ALARM_STEPS)
  }

  async alarm() {}

  async fetch(req: Request) {
    const b = (await req.json()) as any
    switch (b.op) {
      case "wakeups": {
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
        return Response.json({ keys: await this.alarms.dueWakeups(b.now) })
    }
    return new Response("unknown op", { status: 400 })
  }
}

export default { fetch: () => new Response("ok") }
