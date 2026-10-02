import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section, wrapSection } from "@earendil-works/pi-durable"
import type { MemoryOp, MemoryRecord, MemoryResult } from "@kiko/protocol"
import type { TurnMemory } from "../../user/turn-context"
import { declareEffect } from "../effects"
import { isRunTainted } from "./trust"

// Architecture section 13.2. Every run reads `profile`, `now`, and `todo` from the one
// `UserDO.turnContext` call the run makes anyway, so a run that uses no memory tool costs one
// call to `UserDO`. The profile fills the `profile` slot of the system prompt. `now` and `todo`
// go into the input's `<context>` block (`inputContext`), because they change more often and
// would break the cached prefix. The three tools each make one `UserDO.memoryOp` call.

export const MEMORY = "memory"

/** What the agent object gives the extension. */
export type MemoryPort = {
  /** The run's memory from `turnContext`. Loads it once when this process has none. Null without a home. */
  context(): Promise<TurnMemory | null>
  /** One `UserDO.memoryOp` call. */
  op(op: MemoryOp): Promise<MemoryResult>
  /** The author written after each fact, the agent's slug. */
  author: string
}

/** ASSUMPTION: about 4 characters per token, so 1,500 tokens is 6,000 characters. */
export const PROFILE_MAX_CHARS = 6_000

/** At most `max` characters of the profile. Keeps the newest whole lines, which are at the end. */
export function capProfile(body: string, max = PROFILE_MAX_CHARS): string {
  const text = body.trim()
  if (text.length <= max) return text
  const lines = text.split("\n")
  const kept: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (size + line.length + 1 > max) break
    kept.unshift(line)
    size += line.length + 1
  }
  return kept.join("\n")
}

/** The `<context>` text for `now` and `todo`, or undefined when both are empty. */
export function memoryContext(memory: TurnMemory | null): string | undefined {
  if (!memory) return undefined
  const parts: string[] = []
  if (memory.now.trim()) parts.push(`what's going on now (memory record now):\n${memory.now.trim()}`)
  if (memory.todo.trim()) parts.push(`the human's todo list (memory record todo):\n${memory.todo.trim()}`)
  return parts.length ? parts.join("\n\n") : undefined
}

/** Section 13.2: one short paragraph on when to write. Stable, so the cached prefix holds. */
export const MEMORY_RULE = [
  "you have a memory of the human that lasts across every chat. a <profile> block holds what you know about them.",
  "when you learn a lasting fact (a name, a preference, a person in their life, a plan, how they like things done), save it with memory_write right away, one short fact per call, then keep talking.",
  "memory is silent, like a friend's: never say you are remembering, saving, noting, or looking something up, and never mention memory at all unless the human asks about it. just use what you know, naturally.",
  "use the record profile for facts about the human, now for what is going on this week, todo for tasks, or a short id like person-sam for a person or topic.",
  "do not save small talk, secrets like passwords, or what is already saved. when you need something you do not see, use memory_search, then memory_view.",
].join("\n")

const text = (value: string) => [{ type: "text" as const, text: value }]

/** One record as the model reads it: the header, then the dated facts. */
function show(record: MemoryRecord): string {
  const aliases = record.aliases.length ? ` (also: ${record.aliases.join(", ")})` : ""
  return `[${record.id}] ${record.title}${aliases}, ${record.type}\n${record.body.trim() || "(empty)"}`
}

const failed = (result: MemoryResult) => ({ content: text(`memory error: ${"error" in result ? result.error : "unknown"}`), isError: true })

export function memoryExtension(port: MemoryPort): Extension {
  const search = defineTool({
    name: "memory_search",
    description: "search the human's memory by keywords. returns matching records with their facts.",
    parameters: Type.Object({ query: Type.String({ description: "a few keywords, like a name or a topic" }) }),
    replay: "safe",
    execute: async (args) => {
      const result = await port.op({ op: "search", query: args.query, limit: 5 })
      if (!result.ok || !("records" in result)) return failed(result)
      if (!result.records.length) return { content: text(`nothing in memory matches "${args.query}"`) }
      return { content: text(result.records.map(show).join("\n\n")) }
    },
  })

  const view = defineTool({
    name: "memory_view",
    description: "read one memory record by its id, such as profile, now, todo, or an id from memory_search.",
    parameters: Type.Object({ id: Type.String() }),
    replay: "safe",
    execute: async (args) => {
      const result = await port.op({ op: "view", id: args.id })
      if (!result.ok || !("record" in result)) return failed(result)
      if (!result.record) return { content: text(`no memory record ${args.id}`), isError: true }
      return { content: text(show(result.record)) }
    },
  })

  const write = defineTool({
    name: "memory_write",
    description:
      "save one lasting fact to a memory record. it adds a dated line and never erases. a missing record is created. the id is lowercase letters, digits, and dashes.",
    parameters: Type.Object({
      id: Type.String({ description: "profile, now, todo, or a short id like person-sam" }),
      fact: Type.String({ description: "one short fact in plain words" }),
    }),
    execute: async (args, api) => {
      // Section 13.2 and 16.3: a fact written in a run that read outside content is flagged.
      const tainted = isRunTainted(api)
      const provenance = tainted ? { author: port.author, tainted: true } : { author: port.author }
      const result = await port.op({ op: "append", id: args.id, fact: args.fact, provenance })
      if (!result.ok || !("record" in result) || !result.record) return failed(result)
      return { content: text(`saved to ${result.record.id}`) }
    },
  })

  return defineExtension({
    name: MEMORY,
    tools: [declareEffect("read", search), declareEffect("read", view), declareEffect("write", write)],
    sections: [section(MEMORY, () => MEMORY_RULE)],
    wraps: [
      wrapSection("profile", (slot) => ({
        ...slot,
        render: async () => capProfile((await port.context())?.profile ?? "") || undefined,
      })),
    ],
  })
}
