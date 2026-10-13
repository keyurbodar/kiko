import { DurableObject } from "cloudflare:workers"
import { ALARM_STEPS, createAlarms, runDue } from "@kiko/durable/alarm"
import { migrate } from "@kiko/durable/migrate"

export class T extends DurableObject {
  alarms = createAlarms(this.ctx)
  setAlarmCalls = 0
  handled: Record<string, number> = {}

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    migrate(ctx.storage, ALARM_STEPS)
    const real = ctx.storage.setAlarm.bind(ctx.storage)
    ctx.storage.setAlarm = (t: number | Date, o?: any) => {
      this.setAlarmCalls++
      return real(t, o)
    }
  }

  async alarm() {}

  async fetch(req: Request) {
    const b = (await req.json()) as any
    let keys: string[] | undefined
    if (b.op === "set") await this.alarms.setWakeup(b.key, b.at)
    if (b.op === "clear") await this.alarms.clearWakeup(b.key)
    if (b.op === "runDue") {
      const due = await this.alarms.dueWakeups(b.now)
      const ran: string[] = []
      const failed = await runDue(
        this.alarms,
        due,
        { a: () => void ran.push("a"), boom: () => { throw new Error("boom") }, c: () => void ran.push("c") },
        { now: () => b.now, retryMs: { boom: 5000 } },
      )
      const left = await this.ctx.storage.sql.exec<{ key: string; at: number }>("SELECT key, at FROM wakeups ORDER BY key").toArray()
      return Response.json({ due, ran, failed, left })
    }
    if (b.op === "due") {
      keys = await this.alarms.dueWakeups(b.now)
      for (const k of keys) this.handled[k] = (this.handled[k] ?? 0) + 1
    }
    return Response.json({ keys, alarm: await this.ctx.storage.getAlarm(), setAlarmCalls: this.setAlarmCalls, handled: this.handled })
  }
}

export default { fetch: () => new Response("ok") }
