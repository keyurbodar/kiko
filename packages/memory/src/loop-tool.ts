import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import { isRunTainted } from "@yuki/agent/trust"
import { type Certainty, type Loop, LOOP_KINDS, type LoopKind, loopLine, type OpenResult } from "./loops"

export const LOOPS = "loops"

export type LoopPort = {
  /** `mine` makes the calling agent the owner: its own promise. */
  open(input: { kind: LoopKind; certainty: Certainty; text: string; due: string | null; mine: boolean; same?: number; tainted: boolean }): Promise<OpenResult>
  close(id: number, status: "done" | "dropped"): Promise<boolean>
  list(): Promise<Loop[]>
}

export const LOOP_RULE = [
  "open loops are what the human means to do or waits on, and what you promised to come back with. the loop tool is invisible to the human. call it with no text before it, and never mention it afterward: no \"i'll log, note, track, or open\" that, no \"added to your loops\", no \"i'll keep this open\". reply to what they said, as a person would.",
  "- open one when the human states a goal, a plan, a deadline, or that they wait on someone or something. a task with a deadline is an intention. explicit when they commit or name a time; tentative for maybe, thinking about, someday.",
  "- when you promise to come back or follow up later, open a commitment with mine: true.",
  "- a stated deadline or plan is a loop, never a reminder. call create_reminder only when the human asks to be reminded or says yes to your offer. never for a tentative plan.",
  "- close it when they say it is done or no longer wanted. pass same: <id> when they talk about a loop you already see (L<id> in a related or you owe line). skip requests you finish in this reply.",
].join("\n")

const text = (value: string) => [{ type: "text" as const, text: value }]

export function loopExtension(port: () => LoopPort | null): Extension {
  const use = () => {
    const p = port()
    if (!p) throw new Error("this agent is not in a room yet")
    return p
  }
  const loop = defineTool({
    name: "loop",
    description: "keep the human's open loops: goals, plans, deadlines, things they wait on, and your own promises. open, close, or list. invisible to the human: write no text before or after this call about it. never say you logged, noted, tracked, or opened anything.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("open"), Type.Literal("close"), Type.Literal("list")]),
      text: Type.Optional(Type.String({ description: "open: one short line, like 'submit the grant report by friday'" })),
      kind: Type.Optional(Type.Union(LOOP_KINDS.map((k) => Type.Literal(k)), { description: "open: goal, intention (a plan or something they must do), commitment (a promise), waiting, or project" })),
      certainty: Type.Optional(Type.Union([Type.Literal("explicit"), Type.Literal("tentative")])),
      due_iso: Type.Optional(Type.String({ description: "open: the due time or date, ISO 8601, when one is named" })),
      mine: Type.Optional(Type.Boolean({ description: "open: true when it is your own promise to follow up" })),
      same: Type.Optional(Type.Number({ description: "open: the id of a loop this one updates" })),
      id: Type.Optional(Type.Number({ description: "close: the loop id" })),
      status: Type.Optional(Type.Union([Type.Literal("done"), Type.Literal("dropped")], { description: "close: done, or dropped when no longer wanted" })),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const p = use()
      if (args.action === "list") {
        const all = await p.list()
        return { content: text(all.length ? all.map(loopLine).join("\n") : "no open loops") }
      }
      if (args.action === "close") {
        if (typeof args.id !== "number") return { content: text("give the id of the loop to close"), isError: true }
        const done = await p.close(args.id, args.status ?? "done")
        return done ? { content: text(`closed L${args.id}`) } : { content: text(`no open loop L${args.id}`), isError: true }
      }
      if (!args.text || !args.kind) return { content: text("open needs text and kind"), isError: true }
      const out = await p.open({
        kind: args.kind,
        certainty: args.certainty ?? "tentative",
        text: args.text,
        due: args.due_iso ?? null,
        mine: args.mine === true,
        ...(typeof args.same === "number" ? { same: args.same } : {}),
        tainted: isRunTainted(api),
      })
      if (!out.ok) return { content: text(out.error), isError: true }
      return { content: text(`${out.merged ? "updated" : "opened"} L${out.id}`) }
    },
  })
  return defineExtension({ name: LOOPS, tools: [declareEffect("write", loop)], sections: [section(LOOPS, () => LOOP_RULE)] })
}
