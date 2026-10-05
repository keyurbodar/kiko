import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { Trigger } from "@kiko/protocol"
import { Trigger as TriggerSchema } from "@kiko/protocol/schema"
import { Schema } from "effect"
import { describeTrigger, type Reminder, type RoutineRun, type RunDelivery } from "../../user/reminders"
import type { RoutineResult } from "../../user/routines"
import { declareEffect } from "../effects"
import { isRunTainted, runAuthority } from "./trust"

// Architecture section 14, P5-06. Agents schedule reminders for the human, for themselves, or for a
// teammate. `UserDO` owns the table and the alarm. When one fires, the room posts it, and a reminder
// for an agent also wakes that agent with a `system` envelope (reason `reminder`, hop 0).

export const REMINDERS = "reminders"

/** The user's side, bound to this agent's room and slug. */
export type RemindersPort = {
  create(input: { text: string; time: string; tz?: string; rrule?: string; target?: string }): Promise<{ ok: true; reminder: Reminder } | { ok: false; error: string }>
  list(): Promise<Reminder[]>
  cancel(id: string): Promise<{ ok: true } | { ok: false; error: string }>
  /** Routines (architecture section 25). `target` defaults to this agent. */
  createRoutine(input: { name: string; instructions: string; trigger: Trigger; grant: string[]; target?: string; tainted: boolean }): Promise<RoutineResult>
  updateRoutine(id: string, patch: { name?: string; instructions?: string; trigger?: Trigger; grant?: string[]; status?: "active" | "paused" }): Promise<RoutineResult>
  runRoutine(id: string): Promise<RunDelivery | null>
  runs(id: string): Promise<RoutineRun[]>
  /** The room's approval card for a call (section 25.3): the accepted card's id, or the text that ends the call. */
  ask(callKey: string, tool: string, args: Record<string, unknown>, summary: string): Promise<string | { refused: string } | null>
  /** Where the human reaches this kiko, for a webhook's url. */
  origin(): Promise<string | null>
}

const decodeTrigger = Schema.decodeUnknownSync(TriggerSchema)
/** The most instruction characters a routine's card shows in full. */
const CARD_INSTRUCTIONS = 240

/** The trigger, or one line the model can fix. */
function parseTrigger(value: unknown): Trigger | string {
  try {
    return decodeTrigger(value) as Trigger
  } catch (e) {
    return `bad trigger: ${(e instanceof Error ? e.message : String(e)).split("\n").slice(0, 4).join(" ").slice(0, 300)}`
  }
}

const routineLine = (r: Reminder, runs: RoutineRun[]) =>
  `${r.id}: routine "${r.name}" (${r.status}) for @${r.target}, runs ${describeTrigger(r.trigger!, r.tz, r.dueUtc)}${r.grant.length ? `, may use ${r.grant.join(", ")}` : ""}${runs[0] ? `; last run ${runs[0].status}` : ""}`

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
        "write",
        defineTool({
          name: "create_routine",
          description:
            "give an agent in this chat a standing job: it runs its instructions on a schedule or when something happens, and answers here. use when the human wants something done repeatedly or on an event. trigger is one of: {on:'time', at:'<iso with offset>', rrule?:'FREQ=DAILY'}, {on:'task', status?:['review']}, {on:'message', from:'human'|'agent'|'any', contains?}, {on:'file', path:'reports'}, {on:'webhook', match?:[{path,equals|contains}]}, {on:'watch', url, everyMinutes>=15}. may lists tools it can use outside kiko without asking each time; leave it empty unless the human asked for that. when nobody asked, the human gets a card to accept first.",
          parameters: Type.Object({
            name: Type.String({ description: "short, lowercase" }),
            instructions: Type.String({ description: "what to do each run, and what to do when a source is missing" }),
            trigger: Type.Unknown({ description: "when it runs" }),
            may: Type.Optional(Type.Array(Type.String(), { description: "tool names it may use outside kiko" })),
            agent: Type.Optional(Type.String({ description: "who runs it: you (default) or a teammate's handle" })),
          }),
          replay: "unsafe",
          execute: async (args, api) => {
            const trigger = parseTrigger(args.trigger)
            if (typeof trigger === "string") return { content: text(trigger), isError: true }
            const grant = args.may ?? []
            let tainted = isRunTainted(api)
            // Section 25.3. A human asking in this run is the ok. Anything else, or a standing permission
            // outside kiko, waits for the human's card.
            if (tainted || runAuthority(api).origin !== "human" || grant.length) {
              const shown = args.instructions.length <= CARD_INSTRUCTIONS
              const summary = `routine "${args.name}": ${shown ? args.instructions : `${args.instructions.slice(0, CARD_INSTRUCTIONS)}…`} | ${JSON.stringify(trigger)}${grant.length ? ` | may use: ${grant.join(", ")}` : ""}`
              const answer = await user().ask(`${api.conversationId}:${api.callId}`, "create_routine", args as Record<string, unknown>, summary)
              if (answer === null || typeof answer === "object") return { content: text(answer?.refused ?? "not set: the human's ok is needed and no card could be posted.") }
              // The human read and accepted these instructions, so the routine is theirs, not the outside
              // content's: its runs start clean and its grant works. Instructions longer than the card shows
              // keep the run's taint: the human did not see all of them.
              if (shown) tainted = false
            }
            const out = await user().createRoutine({ name: args.name, instructions: args.instructions, trigger, grant, ...(args.agent ? { target: args.agent.replace(/^@/, "") } : {}), tainted })
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
          description: "change, pause, resume, or run now a routine by its id from list_reminders. pausing and running now never need the human; other changes do unless the human asked in this run.",
          parameters: Type.Object({
            id: Type.String(),
            name: Type.Optional(Type.String()),
            instructions: Type.Optional(Type.String()),
            trigger: Type.Optional(Type.Unknown()),
            may: Type.Optional(Type.Array(Type.String())),
            status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused")])),
            run_now: Type.Optional(Type.Boolean()),
          }),
          replay: "unsafe",
          execute: async (args, api) => {
            const trigger = args.trigger === undefined ? undefined : parseTrigger(args.trigger)
            if (typeof trigger === "string") return { content: text(trigger), isError: true }
            const current = (await user().list()).find((r) => r.id === args.id && r.trigger)
            if (!current) return { content: text("no such routine in this chat"), isError: true }
            const widens = (args.may ?? []).some((t) => !current.grant.includes(t))
            const changes = args.name !== undefined || args.instructions !== undefined || trigger !== undefined || args.may !== undefined || args.status === "active"
            if (changes && (isRunTainted(api) || runAuthority(api).origin !== "human" || widens)) {
              const summary = `change routine "${current.name}": ${JSON.stringify({ ...args, id: undefined })}`
              const answer = await user().ask(`${api.conversationId}:${api.callId}`, "update_routine", args as Record<string, unknown>, summary)
              if (answer === null || typeof answer === "object") return { content: text(answer?.refused ?? "not changed: the human's ok is needed and no card could be posted.") }
            }
            let routine = current
            if (changes || args.status) {
              const out = await user().updateRoutine(args.id, {
                ...(args.name !== undefined ? { name: args.name } : {}),
                ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
                ...(trigger !== undefined ? { trigger } : {}),
                ...(args.may !== undefined ? { grant: args.may } : {}),
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
