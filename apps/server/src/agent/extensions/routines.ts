import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { Trigger } from "@kiko/protocol"
import { Trigger as TriggerSchema } from "@kiko/protocol"
import { Schema } from "effect"
import { describeTrigger, type Reminder, type RoutineRun, type RunDelivery } from "../../user/reminders"
import type { RoutineResult } from "../../user/routines"
import { declareEffect } from "@kiko/agent/effects"
import { AgentHomeMissing } from "../errors"

export const ROUTINES = "routines"

export type RoutinesPort = {
  list(): Promise<Reminder[]>
  delete(id: string): Promise<{ ok: true } | { ok: false; error: string }>
  cancel(id: string): Promise<RoutineResult>
  createRoutine(input: {
    name: string
    instructions: string
    trigger: Trigger
    target?: string
  }): Promise<RoutineResult>
  updateRoutine(
    id: string,
    patch: { name?: string; instructions?: string; trigger?: Trigger; status?: "active" | "paused" },
  ): Promise<RoutineResult>
  runRoutine(id: string): Promise<RunDelivery | null>
  runs(id: string): Promise<RoutineRun[]>
  origin(): Promise<string | null>
  self(): string
  addRecipe(slug: string): Promise<{ ok: true; setup: string; existed: boolean } | { ok: false; error: string }>
}

const decodeTrigger = Schema.decodeUnknownSync(TriggerSchema)
const SHAPES = "shapes: {on:'time',at:'<iso with offset>',rrule?} | {on:'message',contains?} | {on:'webhook',match?}"

const TriggerParam = Type.Union([
  Type.Object({
    on: Type.Literal("time"),
    at: Type.Optional(Type.String({ description: "ISO time with an offset, like 2026-05-04T08:30:00+02:00" })),
    in_seconds: Type.Optional(Type.Number({ description: "instead of at: run once this many seconds from now" })),
    rrule: Type.Optional(
      Type.String({
        description: "repeat, like FREQ=DAILY or FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR; at most every 30 minutes",
      }),
    ),
  }),
  Type.Object({
    on: Type.Literal("message"),
    contains: Type.Optional(Type.String({ description: "only human posts here containing this" })),
  }),
  Type.Object({
    on: Type.Literal("webhook"),
    match: Type.Optional(
      Type.Array(
        Type.Object({
          path: Type.String({ description: "dot path into the posted JSON" }),
          equals: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
          contains: Type.Optional(Type.String()),
        }),
        { maxItems: 8 },
      ),
    ),
  }),
])

function tidyArguments(args: unknown): unknown {
  const raw = args as { trigger?: unknown } | null
  if (!raw || typeof raw !== "object" || raw.trigger === undefined) return args
  return { ...raw, trigger: tidyTrigger(raw.trigger) }
}

function runNowLine(ran: RunDelivery | null, target: string, self: string): string {
  if (ran === null) return "not run: it is not active"
  if (ran !== "delivered") return ran
  if (target === self)
    return "queued. it runs after you end this turn and its result comes to you then. end your turn now; do not poll or sleep."
  return `delivered to @${target}. its reply arrives later as a message; do not poll or sleep.`
}

function tidyTrigger(value: unknown, now = Date.now()): unknown {
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
  const seconds = out.in_seconds
  delete out.in_seconds
  if (
    out.on === "time" &&
    out.at === undefined &&
    typeof seconds === "number" &&
    Number.isFinite(seconds) &&
    seconds > 0
  )
    out.at = new Date(now + seconds * 1000).toISOString()
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

export const routineLine = (r: Reminder, runs?: RoutineRun[]) => {
  const last = runs?.[0]
  const trigger = r.trigger ? describeTrigger(r.trigger, r.tz, r.dueUtc) : "no supported trigger"
  const details = [`${r.id}: routine "${r.name}" (${r.status}) for @${r.target}, chat ${r.roomId}, runs ${trigger}`]
  if (last) {
    details.push(
      `last run ${last.status}, started ${new Date(last.startedAt).toISOString()}${last.endedAt === null ? "" : `, ended ${new Date(last.endedAt).toISOString()}`}`,
    )
  } else if (runs) {
    details.push("no runs yet")
  }
  if (r.fails) details.push(`consecutive failures ${r.fails}`)
  return `${details.join("; ")}\ninstructions: ${r.text}`
}

const text = (t: string) => [{ type: "text" as const, text: t }]

export function routinesExtension(port: () => RoutinesPort | null): Extension {
  const user = () => {
    const p = port()
    if (!p) throw new AgentHomeMissing({ message: "this agent is not in a room yet" })
    return p
  }
  return defineExtension({
    name: ROUTINES,
    tools: [
      declareEffect(
        "write",
        defineTool({
          name: "create_routine",
          description:
            'A job that runs on its own: a reminder (a time trigger without rrule runs once), a schedule, or a reaction to the human\'s posts here or to a webhook. Saying "got it" sets nothing. Use the zone on the now line and say which you used. Agent messages never trigger it; to talk with an agent use send_message. To return to something later yourself, make a one-time routine.',
          parameters: Type.Object({
            name: Type.String({ description: "short, lowercase" }),
            instructions: Type.String({ description: "what to do each run, and what to do when a source is missing" }),
            trigger: TriggerParam,
            agent: Type.Optional(
              Type.String({ description: "who runs it: omit for yourself, or any agent's handle from list_agents" }),
            ),
          }),
          replay: "unsafe",
          prepareArguments: (args) => tidyArguments(args) as never,
          execute: async (args) => {
            const trigger = parseTrigger(args.trigger)
            if (typeof trigger === "string") return { output: text(trigger), isError: true }
            const target = otherAgent(args.agent)
            const out = await user().createRoutine({
              name: args.name,
              instructions: args.instructions,
              trigger,
              ...(target ? { target } : {}),
            })
            if (!out.ok) return { output: text(`not set: ${out.error}`), isError: true }
            const hook = out.token
              ? `\nits webhook url is ${(await user().origin()) ?? ""}/api/hooks/${out.token} . tell the human this url once; it is not shown again.`
              : ""
            return { output: text(`routine set: ${routineLine(out.routine, [])}${hook}`) }
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "update_routine",
          description:
            "Change, pause, resume, reschedule, or run now a routine by its id from list_routines. Give a completed routine a new trigger to schedule it again.",
          parameters: Type.Object({
            id: Type.String(),
            name: Type.Optional(Type.String()),
            instructions: Type.Optional(Type.String()),
            trigger: Type.Optional(TriggerParam),
            status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("paused")])),
            run_now: Type.Optional(Type.Boolean()),
          }),
          replay: "unsafe",
          prepareArguments: (args) => tidyArguments(args) as never,
          execute: async (args) => {
            const trigger = args.trigger === undefined ? undefined : parseTrigger(args.trigger)
            if (typeof trigger === "string") return { output: text(trigger), isError: true }
            const current = (await user().list()).find((r) => r.id === args.id && r.trigger)
            if (!current) return { output: text("no such routine available to you"), isError: true }
            const changes =
              args.name !== undefined ||
              args.instructions !== undefined ||
              trigger !== undefined ||
              args.status === "active"
            let routine = current
            let hook = ""
            if (changes || args.status) {
              const routineChanges = () => ({
                ...(args.name !== undefined ? { name: args.name } : {}),
                ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
                ...(trigger !== undefined ? { trigger } : {}),
                ...(args.status ? { status: args.status } : {}),
              })
              const out = await user().updateRoutine(args.id, routineChanges())
              if (!out.ok) return { output: text(`not changed: ${out.error}`), isError: true }
              routine = out.routine
              if (out.token)
                hook = `\nits webhook url is ${(await user().origin()) ?? ""}/api/hooks/${out.token} . tell the human this url once; it is not shown again.`
            }
            const ran = args.run_now ? await user().runRoutine(args.id) : null
            return {
              output: text(
                `${routineLine(routine, await user().runs(routine.id))}${hook}${args.run_now ? `\nrun now: ${runNowLine(ran, routine.target, user().self())}` : ""}`,
              ),
            }
          },
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "list_routines",
          description:
            "List all noncancelled routines in this chat, including completed and failed ones, with instructions, state, and the last run's status and time.",
          parameters: Type.Object({}),
          replay: "safe",
          execute: async () => {
            const all = (await user().list()).filter((r) => r.status !== "cancelled")
            const lines = await Promise.all(all.map(async (r) => routineLine(r, await user().runs(r.id))))
            return { output: text(lines.length ? lines.join("\n") : "no routines") }
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "add_recipe",
          description:
            "Add one of the human's recipes (from /home/recipes, listed with the skills) to this chat, run by you. It makes the recipe's routines at once. Use it when the human wants a recipe set up here.",
          parameters: Type.Object({
            slug: Type.String({ description: "the recipe's folder name, like morning-briefing" }),
          }),
          replay: "unsafe",
          execute: async ({ slug }) => {
            const out = await user().addRecipe(slug.trim())
            return out.ok
              ? { output: text(out.existed ? out.setup : `added.\n${out.setup}`) }
              : { output: text(`not added: ${out.error}`), isError: true }
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "delete_routine",
          description:
            "Permanently delete a routine, its instructions, and run history by id. Use cancel_routine to stop it while keeping its history.",
          parameters: Type.Object({ id: Type.String() }),
          replay: "safe",
          execute: async ({ id }) => {
            const out = await user().delete(id)
            return out.ok ? { output: text("deleted") } : { output: text(out.error), isError: true }
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "cancel_routine",
          description: "Cancel a reminder or routine by its id from list_routines.",
          parameters: Type.Object({ id: Type.String() }),
          replay: "safe",
          execute: async ({ id }) => {
            const out = await user().cancel(id)
            return out.ok ? { output: text("cancelled") } : { output: text(out.error), isError: true }
          },
        }),
      ),
    ],
  })
}
