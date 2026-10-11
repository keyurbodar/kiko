import type { Trigger } from "@yuki/protocol"
import { sha256Hex } from "@yuki/durable/hash"
import { safeFetch } from "@yuki/durable/safe-fetch"
import { defaultFetcher } from "../lib/dev-fixture-fetch"
import { htmlToText } from "@yuki/durable/html-text"
import type { Env } from "../index"
import { roomStub } from "../lib/names"
import type { ExtensionStore } from "./extensions"
import { asResult, type NewRoutine, type Reminder, type Reminders } from "./reminders"
import { matchWebhook, roomRoutine, type RoutineResult, routineResult } from "./routines"

const HOOK_EXCERPT = 6_000

type RoutineDeps = {
  env: Env
  reminders: Reminders
  extensions: ExtensionStore
}

export class RoutineWiring {
  constructor(private readonly d: RoutineDeps) {}

  async cancelReminder(id: string) {
    return asResult(async () => {
      const before = this.d.reminders.get(id)
      const out = await this.d.reminders.cancel(id)
      if (out?.trigger) await this.routineChanged(out, undefined, before)
      return out
    })
  }

  async createRoutine(owner: string, input: NewRoutine): Promise<RoutineResult> {
    return routineResult(async () => {
      const out = await this.d.reminders.createRoutine(owner, input)
      await this.routineChanged(out.routine, out.token)
      return out
    })
  }

  async updateRoutine(id: string, patch: Parameters<Reminders["updateRoutine"]>[1]): Promise<RoutineResult> {
    return routineResult(async () => {
      const before = this.d.reminders.get(id)
      const out = await this.d.reminders.updateRoutine(id, patch)
      if (!out) return null
      if (before?.trigger?.on === "webhook" && out.routine.trigger?.on !== "webhook") await this.dropHook(id)
      await this.routineChanged(out.routine, out.token, before)
      return out
    })
  }

  async routineHook(routineId: string, token: string, deliveryKey: string, body: string): Promise<"ran" | "held" | "skipped" | "unknown"> {
    const routine = await this.d.reminders.byHook(routineId, token)
    if (routine?.trigger?.on !== "webhook") return "unknown"
    let json: unknown = null
    try {
      json = JSON.parse(body)
    } catch {
      json = null
    }
    if (!matchWebhook(routine.trigger.match ?? [], json)) return "skipped"
    const shown = body.length > HOOK_EXCERPT ? `${body.slice(0, HOOK_EXCERPT)}\n[cut at ${HOOK_EXCERPT} characters]` : body
    const out = await this.d.reminders.fireEvent(routineId, `hook:${deliveryKey}`, "a post to its webhook", `the post:\n${shown}`)
    return out === "delivered" || out === "duplicate" ? "ran" : out === "held" ? "held" : "skipped"
  }

  async routineChanged(routine: Reminder, token?: string, before?: Reminder | null): Promise<void> {
    const owner = this.d.reminders.owner()
    if (!owner) return
    const event = (r?: Reminder | null) => r?.trigger?.on === "task" || r?.trigger?.on === "message" || r?.trigger?.on === "file"
    if (event(routine) || event(before)) await roomStub(this.d.env.ROOM, owner, routine.roomId).setRoutines(this.d.reminders.roomRoutines(routine.roomId).map(roomRoutine))
    if (routine.trigger?.on !== "webhook") return
    if (routine.status === "cancelled") return this.dropHook(routine.id)
    if (!token) return
    try {
      await this.d.env.AUTH_DB.prepare('insert into "hooks" ("token_hash", "user_id", "routine_id", "created_at") values (?, ?, ?, ?)')
        .bind(await sha256Hex(token), owner, routine.id, Date.now())
        .run()
    } catch (e) {
      console.error(`webhook row not stored: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async dropHook(routineId: string): Promise<void> {
    await this.d.env.AUTH_DB.prepare('delete from "hooks" where "routine_id" = ?').bind(routineId).run()
  }

  async watchPage(trigger: Extract<Trigger, { on: "watch" }>): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    try {
      if (trigger.extension) {
        const res = await this.d.extensions.fetch(trigger.extension, { url: trigger.url, method: "GET", ...(trigger.headers ? { headers: { ...trigger.headers } } : {}) })
        return res.status >= 400 ? { ok: false, error: `status ${res.status}` } : { ok: true, text: res.text }
      }
      const page = await safeFetch(trigger.url, defaultFetcher(), { maxBytes: 256 * 1024 })
      if (!page.ok) return { ok: false, error: page.reason }
      if (page.status >= 400) return { ok: false, error: `status ${page.status}` }
      const raw = new TextDecoder().decode(page.body)
      const type = (page.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? ""
      return { ok: true, text: type === "text/html" || (!type && /<html\b/i.test(raw)) ? htmlToText(raw) : raw }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
