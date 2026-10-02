import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { Reminder } from "../../user/reminders"
import { declareEffect } from "../effects"

// Architecture section 14, P5-06. Agents schedule reminders for the human, for themselves, or for a
// teammate. `UserDO` owns the table and the alarm. When one fires, the room posts it, and a reminder
// for an agent also wakes that agent with a `system` envelope (reason `reminder`, hop 0).

export const REMINDERS = "reminders"

/** The user's side, bound to this agent's room and slug. */
export type RemindersPort = {
  create(input: { text: string; time: string; tz?: string; rrule?: string; target?: string }): Promise<{ ok: true; reminder: Reminder } | { ok: false; error: string }>
  list(): Promise<Reminder[]>
  cancel(id: string): Promise<{ ok: true } | { ok: false; error: string }>
}

const text = (t: string) => [{ type: "text" as const, text: t }]

/** `in_seconds` or `time_iso`, as the ISO time the store wants. Null when neither is usable. */
export function whenOf(args: { time_iso?: string; in_seconds?: number }, now = Date.now()): string | null {
  if (typeof args.in_seconds === "number" && Number.isFinite(args.in_seconds) && args.in_seconds > 0) return new Date(now + args.in_seconds * 1000).toISOString()
  if (args.time_iso && !Number.isNaN(Date.parse(args.time_iso))) return args.time_iso
  return null
}

const line = (r: Reminder, tz: string) =>
  `${r.id}: "${r.text}" for ${r.target === "human" ? "the human" : `@${r.target}`} at ${new Date(r.dueUtc).toLocaleString("en-US", { timeZone: tz })}${r.rrule ? ` (repeats ${r.rrule})` : ""}`

export function remindersExtension(port: () => RemindersPort | null, tz: () => string): Extension {
  const user = () => {
    const p = port()
    if (!p) throw new Error("this agent is not in a room yet")
    return p
  }
  return defineExtension({
    name: REMINDERS,
    tools: [
      declareEffect(
        "write",
        defineTool({
          name: "create_reminder",
          description:
            "schedule a reminder. for the human by default (it shows in this chat), or for yourself or a teammate with target (it wakes them). give in_seconds for relative times like 'in 10 minutes', or time_iso with an offset for a clock time. rrule (RFC 5545, like FREQ=DAILY) repeats it.",
          parameters: Type.Object({
            text: Type.String({ description: "what to remind about, short" }),
            in_seconds: Type.Optional(Type.Number({ description: "seconds from now" })),
            time_iso: Type.Optional(Type.String({ description: "ISO 8601 with Z or an offset" })),
            rrule: Type.Optional(Type.String({ description: "RFC 5545 rule, e.g. FREQ=WEEKLY;BYDAY=MO" })),
            target: Type.Optional(Type.String({ description: "human (default), or an agent slug in this room" })),
          }),
          replay: "unsafe",
          execute: async (args) => {
            const time = whenOf(args)
            if (!time) return { content: text("give in_seconds (a positive number) or a valid time_iso."), isError: true }
            if (Date.parse(time) < Date.now() - 1000) return { content: text("that time is in the past. pick a future time."), isError: true }
            const out = await user().create({ text: args.text, time, tz: tz(), rrule: args.rrule, target: args.target?.replace(/^@/, "") })
            if (!out.ok) return { content: text(`not scheduled: ${out.error}`), isError: true }
            return { content: text(`scheduled ${line(out.reminder, tz())}`) }
          },
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "list_reminders",
          description: "list the active reminders in this chat.",
          parameters: Type.Object({}),
          replay: "safe",
          execute: async () => {
            const all = (await user().list()).filter((r) => r.status === "active")
            return { content: text(all.length ? all.map((r) => line(r, tz())).join("\n") : "no active reminders") }
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "cancel_reminder",
          description: "cancel a reminder by its id from list_reminders.",
          parameters: Type.Object({ id: Type.String() }),
          replay: "safe",
          execute: async ({ id }) => {
            const out = await user().cancel(id)
            return out.ok ? { content: text("cancelled") } : { content: text(out.error), isError: true }
          },
        }),
      ),
    ],
  })
}
