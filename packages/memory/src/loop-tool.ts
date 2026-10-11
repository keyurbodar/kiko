import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"

const LOOPS = "loops"

/** Scoped to the agent's own chat. Loops open in the background (architecture section 26.2); a run only closes them. */
export type LoopPort = { close(id: number, status: "done" | "dropped"): Promise<boolean> }

const LOOP_RULE = "when the human says an open loop (L<id> in your context) is done, or that they no longer want it, close it with the loop tool. say nothing about it."

const text = (value: string) => [{ type: "text" as const, text: value }]

export function loopExtension(port: () => LoopPort | null): Extension {
  const loop = defineTool({
    name: "loop",
    description: "close an open loop L<id>. done: it happened. dropped: the human no longer wants it followed up, or will handle it themselves.",
    parameters: Type.Object({
      id: Type.Number(),
      status: Type.Union([Type.Literal("done"), Type.Literal("dropped")]),
    }),
    replay: "safe",
    execute: async (args) => {
      const p = port()
      if (!p) throw new Error("this agent is not in a room yet")
      return (await p.close(args.id, args.status)) ? { content: text(`closed L${args.id}`) } : { content: text(`no open loop L${args.id}`), isError: true }
    },
  })
  return defineExtension({ name: LOOPS, tools: [declareEffect("write", loop)], sections: [section(LOOPS, () => LOOP_RULE)] })
}
