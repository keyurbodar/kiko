import type { AgentSlug, RoomId } from "@kiko/protocol"
import { sha256Hex } from "@kiko/durable/hash"
import type { NewRoutine, Reminder, Reminders } from "./reminders"
import { matchWebhook, roomRoutine, type RoomRoutine, type RoutineResult, routineResult } from "./routines"

const HOOK_EXCERPT = 6_000

type RoutineDeps = {
  reminders: Reminders
  setRoutines(roomId: RoomId, routines: RoomRoutine[]): Promise<void>
  routineCreated(roomId: RoomId, slug: AgentSlug, id: string, name: string, byAgent: boolean): Promise<void>
}

export class RoutineWiring {
  constructor(private readonly d: RoutineDeps) {}

  async deleteRoutine(id: string): Promise<{ ok: true }> {
    const before = this.d.reminders.get(id)
    if (before) {
      const cancelled = await this.d.reminders.cancel(id)
      if (cancelled) await this.routineChanged(cancelled, before)
    }
    await this.d.reminders.deleteRoutine(id)
    return { ok: true }
  }

  async cancelRoutine(id: string): Promise<RoutineResult> {
    return routineResult(async () => {
      const before = this.d.reminders.get(id)
      const out = await this.d.reminders.cancel(id)
      if (!out) return null
      await this.routineChanged(out, before)
      return { routine: out }
    })
  }

  async createRoutine(owner: string, input: NewRoutine): Promise<RoutineResult> {
    return routineResult(async () => {
      const out = await this.d.reminders.createRoutine(owner, input)
      try {
        await this.routineChanged(out.routine)
      } catch (e) {
        await this.d.reminders.deleteRoutine(out.routine.id)
        throw e
      }
      const { routine } = out
      await this.postDivider(routine)
      return out
    })
  }

  private async postDivider(routine: Reminder): Promise<void> {
    const byAgent = routine.createdBy !== "human"
    const slug = (byAgent ? routine.createdBy : routine.target) as AgentSlug
    try {
      await this.d.routineCreated(routine.roomId, slug, routine.id, routine.name ?? routine.text, byAgent)
    } catch {}
  }

  async updateRoutine(id: string, patch: Parameters<Reminders["updateRoutine"]>[1]): Promise<RoutineResult> {
    return routineResult(async () => {
      const before = this.d.reminders.get(id)
      const out = await this.d.reminders.updateRoutine(id, patch)
      if (!out) return null
      await this.routineChanged(out.routine, before)
      return out
    })
  }

  async routineHook(token: string, deliveryKey: string, body: string): Promise<"ran" | "held" | "skipped" | "unknown"> {
    const routine = this.d.reminders.byHook(await sha256Hex(token))
    if (routine?.trigger?.on !== "webhook") return "unknown"
    let json: unknown = null
    try {
      json = JSON.parse(body)
    } catch {
      json = null
    }
    if (!matchWebhook(routine.trigger.match ?? [], json)) return "skipped"
    const shown =
      body.length > HOOK_EXCERPT ? `${body.slice(0, HOOK_EXCERPT)}\n[cut at ${HOOK_EXCERPT} characters]` : body
    const out = await this.d.reminders.fireEvent(
      routine.id,
      `hook:${deliveryKey}`,
      "a post to its webhook",
      `the post:\n${shown}`,
    )
    return out === "delivered" || out === "duplicate" ? "ran" : out === "held" ? "held" : "skipped"
  }

  async routineChanged(routine: Reminder, before?: Reminder | null): Promise<void> {
    const event = (r?: Reminder | null) => r?.trigger?.on === "message"
    if (event(routine) || event(before))
      await this.d.setRoutines(routine.roomId, this.d.reminders.roomRoutines(routine.roomId).map(roomRoutine))
  }
}
