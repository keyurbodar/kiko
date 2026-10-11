import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { Trigger } from "@yuki/protocol"
import { Trigger as TriggerSchema } from "@yuki/protocol/schema"
import { Schema } from "effect"
import { describeTrigger, type Reminder, type RoutineRun, type RunDelivery } from "../../user/reminders"
import type { RoutineResult } from "../../user/routines"
import { declareEffect } from "@yuki/agent/effects"

export const REMINDERS = "reminders"

export type RemindersPort = {
  create(input: { text: string; time: string; tz?: string; rrule?: string; target?: string }): Promise<{ ok: true; reminder: Reminder } | { ok: false; error: string }>
  list(): Promise<Reminder[]>
  cancel(id: string): Promise<{ ok: true } | { ok: false; error: string }>
  createRoutine(input: { name: string; instructions: string; trigger: Trigger; target?: string }): Promise<RoutineResult>
  updateRoutine(id: string, patch: { name?: string; instructions?: string; trigger?: Trigger; status?: "active" | "paused" }): Promise<RoutineResult>
  runRoutine(id: string): Promise<RunDelivery | null>
  runs(id: string): Promise<RoutineRun[]>
  origin(): Promise<string | null>
}

const decodeTrigger = Schema.decodeUnknownSync(TriggerSchema)
const SHAPES = "shapes: {on:'time',at:'<iso with offset>',rrule?} | {on:'task',status?:['review']} | {on:'message',from:'human'|'agent'|'any',contains?} | {on:'file',path} | {on:'webhook',match?} | {on:'watch',url,everyMinutes:15 or more}"

function tidyTrigger(value: unknown): unknown {
  let v = value
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return v
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined && x !== "") out[k] = x
  if (typeof out.status === "string") out.status = [out.status]
  if (typeof out.everyMinutes === "string" && out.everyMinutes.trim() !== "") out.everyMinutes = Number(out.everyMinutes)
  return out
}

function otherAgent(agent: string | undefined): string | undefined {
  const handle = agent?.trim().replace(/^@/, "").toLowerCase()
  return handle && !["you", "me", "self", "myself", "yourself", "default", "none"].includes(handle) ? handle : undefined
}

function parseTrigger(value: unknown): Trigger | string {
  try {
    return decodeTrigger(tidyTrigger(value)) as Trigger
  } catch (e) {
    return `bad trigger: ${(e instanceof Error ? e.message : String(e)).split("\n").slice(0, 3).join(" ").slice(0, 200)}. ${SHAPES}`
  }
}

const routineLine = (r: Reminder, runs: RoutineRun[]) => {
  if (r.trigger === null) throw new Error(`routine ${r.id} has no trigger`)
  return `${r.id}: routine "${r.name}" (${r.status}) for @${r.target}, runs ${describeTrigger(r.trigger, r.tz, r.dueUtc)}${runs[0] ? `; last run ${runs[0].status}` : ""}`
}

const text = (t: string) => [{ type: "text" as const, text: t }]

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
            "schedule a reminder when the human wants one, or for yourself to keep a promise. never because they mention a deadline, plan, or wait; those are kept without you. say nothing about it unless they asked. for the human by default (it shows in this chat), or for yourself or a teammate with target (it wakes them). give in_seconds for relative times like 'in 10 minutes', or time_iso with an offset for a clock time. rrule (RFC 5545, like FREQ=DAILY) repeats it.",
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
        "write",
        defineTool({
          name: "create_routine",
          description:
            "give an agent in this chat a standing job that runs on its own and answers here. use it whenever the human wants something done on a schedule (every day, each monday) or when something happens (whenever, when a task, if a page changes); saying \"got it\" sets nothing. triggers: {on:'time', at:'<iso with offset>', rrule?:'FREQ=DAILY'} for a schedule, at most every 30 minutes (a weekday 8:30 is at: the next 08:30 with an offset, rrule 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'; use the zone on the now line, which is UTC when the human never set one, and tell them which zone you used; never ask for a zone first); {on:'task', status?:['blocked']} when a task here changes; {on:'message', from:'human'|'agent'|'any', contains?} when someone posts here; {on:'file', path:'invoices'} when files under a folder change; {on:'webhook', match?:[{path,equals|contains}]} for posts from an outside service; {on:'watch', url, everyMinutes>=15} to notice a page change, which checks without running you, so use it instead of a frequent schedule. a plain one-off nudge for the human is create_reminder.",
          parameters: Type.Object({
            name: Type.String({ description: "short, lowercase" }),
            instructions: Type.String({ description: "what to do each run, and what to do when a source is missing" }),
            trigger: Type.Unknown({ description: "when it runs" }),
            agent: Type.Optional(Type.String({ description: "who runs it: omit for yourself, or a teammate's handle" })),
          }),
          replay: "unsafe",
          execute: async (args) => {
            const trigger = parseTrigger(args.trigger)
            if (typeof trigger === "string") return { content: text(trigger), isError: true }
            const target = otherAgent(args.agent)
            const out = await user().createRoutine({ name: args.name, instructions: args.instructions, trigger, ...(target ? { target } : {}) })
            if (!out.ok) return { content: text(`not set: ${out.error}`), isError: true }
            const hook = out.token ? `\nits webhook url is ${(await user().origin()) ?? ""}/api/hooks/${out.token} . tell the human this url once; it is not shown again.` : ""
            return { content: text(`routine set: ${routineLine(out.routine, [])}${hook}`) }
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "update_routine",
          description: "change, pause, resume, or run now a routine by its id from list_reminders.",
          parameters: Type.Object({
            id: Type.String(),
            name: Type.Optional(Type.String()),
            instructions: Type.Optional(Type.String()),
            trigger: Type.Optional(Type.Unknown()),
            status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused")])),
            run_now: Type.Optional(Type.Boolean()),
          }),
          replay: "unsafe",
          execute: async (args) => {
            const trigger = args.trigger === undefined ? undefined : parseTrigger(args.trigger)
            if (typeof trigger === "string") return { content: text(trigger), isError: true }
            const current = (await user().list()).find((r) => r.id === args.id && r.trigger)
            if (!current) return { content: text("no such routine in this chat"), isError: true }
            const changes = args.name !== undefined || args.instructions !== undefined || trigger !== undefined || args.status === "active"
            let routine = current
            if (changes || args.status) {
              const out = await user().updateRoutine(args.id, {
                ...(args.name !== undefined ? { name: args.name } : {}),
                ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
                ...(trigger !== undefined ? { trigger } : {}),
                ...(args.status ? { status: args.status } : {}),
              })
              if (!out.ok) return { content: text(`not changed: ${out.error}`), isError: true }
              routine = out.routine
            }
            const ran = args.run_now ? await user().runRoutine(args.id) : null
            return { content: text(`${routineLine(routine, [])}${args.run_now ? `\nrun now: ${ran ?? "not run: it is not active"}` : ""}`) }
          },
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "list_reminders",
          description: "list the reminders and routines in this chat, with each routine's last run.",
          parameters: Type.Object({}),
          replay: "safe",
          execute: async () => {
            const all = (await user().list()).filter((r) => r.status === "active" || (r.trigger && r.status === "paused"))
            const lines = await Promise.all(all.map(async (r) => (r.trigger ? routineLine(r, await user().runs(r.id)) : line(r, tz()))))
            return { content: text(lines.length ? lines.join("\n") : "no reminders or routines") }
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "cancel_reminder",
          description: "cancel a reminder or routine by its id from list_reminders.",
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
