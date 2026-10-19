import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { Trigger } from "@kiko/protocol"
import { Trigger as TriggerSchema } from "@kiko/protocol/schema"
import { Schema } from "effect"
import { describeTrigger, type Reminder, type RoutineRun, type RunDelivery } from "../../user/reminders"
import type { RoutineResult } from "../../user/routines"
import { declareEffect } from "@kiko/agent/effects"

export const ROUTINES = "routines"

export type RoutinesPort = {
  list(): Promise<Reminder[]>
  cancel(id: string): Promise<RoutineResult>
  createRoutine(input: { name: string; instructions: string; trigger: Trigger; target?: string }): Promise<RoutineResult>
  updateRoutine(id: string, patch: { name?: string; instructions?: string; trigger?: Trigger; status?: "active" | "paused" }): Promise<RoutineResult>
  runRoutine(id: string): Promise<RunDelivery | null>
  runs(id: string): Promise<RoutineRun[]>
  origin(): Promise<string | null>
  addRecipe(slug: string): Promise<{ ok: true; setup: string; existed: boolean } | { ok: false; error: string }>
}

const decodeTrigger = Schema.decodeUnknownSync(TriggerSchema)
const SHAPES = "shapes: {on:'time',at:'<iso with offset>',rrule?} | {on:'message',contains?} | {on:'webhook',match?}"

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
  if (out.on === "time" && out.at === undefined && typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) out.at = new Date(now + seconds * 1000).toISOString()
  return out
}

function otherAgent(agent: string | undefined): string | undefined {
  const handle = agent?.trim().replace(/^@/, "").toLowerCase()
  return handle && !["you", "me", "self", "myself", "yourself", "default", "none"].includes(handle) ? handle : undefined
}

export function parseTrigger(value: unknown): Trigger | string {
  try {
    return decodeTrigger(tidyTrigger(value)) as Trigger
  } catch (e) {
    return `bad trigger: ${(e instanceof Error ? e.message : String(e)).split("\n").slice(0, 3).join(" ").slice(0, 200)}. ${SHAPES}`
  }
}

const routineLine = (r: Reminder, runs: RoutineRun[]) => {
  if (r.trigger === null) throw new Error(`routine ${r.id} has no trigger`)
  return `${r.id}: routine "${r.name}" (${r.status}) for @${r.target}, chat ${r.roomId}, runs ${describeTrigger(r.trigger, r.tz, r.dueUtc)}${runs[0] ? `; last run ${runs[0].status}` : ""}`
}

const text = (t: string) => [{ type: "text" as const, text: t }]

export function routinesExtension(port: () => RoutinesPort | null): Extension {
  const user = () => {
    const p = port()
    if (!p) throw new Error("this agent is not in a room yet")
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
            "Give yourself or any of the human's agents a job that runs on its own. Pass agent with the intended owner's handle; omitting it runs as you. A teammate answers here; an agent outside this chat answers in its own chat. Use it whenever the human wants a reminder, or something done on a schedule (every day, each Monday) or when something happens (whenever they post, a service posts to a webhook). Saying \"got it\" sets nothing. A reminder is a routine that runs once: trigger {on:'time', in_seconds:600} or {on:'time', at:'<iso with offset>'}, with instructions that say what to tell the human. Triggers: {on:'time', at:'<iso with offset>', rrule?:'FREQ=DAILY'} for a schedule, at most every 30 minutes (a weekday 8:30 is at: the next 08:30 with an offset, rrule 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'; use the zone on the now line, which is UTC when the human never set one, and say which zone you used; never ask for a zone first); {on:'message', contains?} when the human posts here (agent messages never match; never make a routine to talk with another agent, message the agent with send_message); {on:'webhook', match?:[{path,equals|contains}]} for posts from an outside service. To return to something yourself later, make a one-time routine for yourself.",
          parameters: Type.Object({
            name: Type.String({ description: "short, lowercase" }),
            instructions: Type.String({ description: "what to do each run, and what to do when a source is missing" }),
            trigger: Type.Unknown({ description: "when it runs" }),
            agent: Type.Optional(Type.String({ description: "who runs it: omit for yourself, or any agent's handle from list_agents" })),
          }),
          replay: "unsafe",
          execute: async (args) => {
            const trigger = parseTrigger(args.trigger)
            if (typeof trigger === "string") return { output: text(trigger), isError: true }
            const target = otherAgent(args.agent)
            const out = await user().createRoutine({ name: args.name, instructions: args.instructions, trigger, ...(target ? { target } : {}) })
            if (!out.ok) return { output: text(`not set: ${out.error}`), isError: true }
            const hook = out.token ? `\nits webhook url is ${(await user().origin()) ?? ""}/api/hooks/${out.token} . tell the human this url once; it is not shown again.` : ""
            return { output: text(`routine set: ${routineLine(out.routine, [])}${hook}`) }
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "update_routine",
          description: "Change, pause, resume, or run now a routine by its id from list_routines.",
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
            if (typeof trigger === "string") return { output: text(trigger), isError: true }
            const current = (await user().list()).find((r) => r.id === args.id && r.trigger)
            if (!current) return { output: text("no such routine in this chat"), isError: true }
            const changes = args.name !== undefined || args.instructions !== undefined || trigger !== undefined || args.status === "active"
            let routine = current
            if (changes || args.status) {
              const out = await user().updateRoutine(args.id, {
                ...(args.name !== undefined ? { name: args.name } : {}),
                ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
                ...(trigger !== undefined ? { trigger } : {}),
                ...(args.status ? { status: args.status } : {}),
              })
              if (!out.ok) return { output: text(`not changed: ${out.error}`), isError: true }
              routine = out.routine
            }
            const ran = args.run_now ? await user().runRoutine(args.id) : null
            return { output: text(`${routineLine(routine, [])}${args.run_now ? `\nrun now: ${ran ?? "not run: it is not active"}` : ""}`) }
          },
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "list_routines",
          description: "List the routines in this chat, with each routine's last run.",
          parameters: Type.Object({}),
          replay: "safe",
          execute: async () => {
            const all = (await user().list()).filter((r) => r.status === "active" || r.status === "paused")
            const lines = await Promise.all(all.map(async (r) => routineLine(r, await user().runs(r.id))))
            return { output: text(lines.length ? lines.join("\n") : "no routines") }
          },
        }),
      ),
      declareEffect(
        "write",
        defineTool({
          name: "add_recipe",
          description: "Add one of the human's recipes (from /home/recipes, listed with the skills) to this chat, run by you. It makes the recipe's routines at once. Use it when the human wants a recipe set up here.",
          parameters: Type.Object({ slug: Type.String({ description: "the recipe's folder name, like morning-briefing" }) }),
          replay: "unsafe",
          execute: async ({ slug }) => {
            const out = await user().addRecipe(slug.trim())
            return out.ok ? { output: text(out.existed ? out.setup : `added.\n${out.setup}`) } : { output: text(`not added: ${out.error}`), isError: true }
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
