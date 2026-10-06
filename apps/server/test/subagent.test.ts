import { expect, test } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { Harness, MemoryStorage } from "@earendil-works/pi-durable"
import { TRUST_TOOLS_EXTENSION } from "../src/agent/dev-fake"
import type { MessagingPort } from "../src/agent/extensions/messaging"
import type { RemindersPort } from "../src/agent/extensions/reminders"
import type { WorkspacePort } from "../src/agent/extensions/workspace"
import { buildAgent } from "../src/agent/factory"

// Architecture sections 7.5 and 8, audit row 10. A helper's or a teammate's answer carries its taint
// back to the run that asked, and a helper gets no tools that outlive its answer or reach others.

const context = BACKGROUND_CONTEXT
type Msg = { role: string; toolName?: string; content?: { type: string; text?: string }[] }
type Request = { messages: readonly unknown[] }

/** The parent asks a helper, the helper does `helper`, and the parent then writes a note. Returns the note's result and the helper's tool names. */
async function delegate(helper: ReturnType<typeof fauxToolCall>[]) {
  const workspace: WorkspacePort = { call: async () => ({ ok: true, text: "ok" }) }
  const reminders = { port: () => null as RemindersPort | null, tz: () => "UTC" }
  const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, workspace, reminders, testExtensions: [TRUST_TOOLS_EXTENSION] })
  const faux = fauxProvider()
  let helperTools: string[] = []
  let last: Msg[] = []
  const steps: ((r: Request) => ReturnType<typeof fauxAssistantMessage>)[] = [
    () => fauxAssistantMessage(fauxToolCall("spawn_subagent", { task: "look it up" }), { stopReason: "toolUse" }),
    ...helper.map((call) => (r: Request) => {
      // The tool list travels inside the transcript as a system message.
      helperTools = [...JSON.stringify(r.messages).matchAll(/"name":"([\w-]+)","description"/g)].map((m) => m[1]!)
      return fauxAssistantMessage(call, { stopReason: "toolUse" })
    }),
    () => fauxAssistantMessage("the page says hi"),
    () => fauxAssistantMessage(fauxToolCall("fake_note", {}), { stopReason: "toolUse" }),
    (r) => {
      last = r.messages as Msg[]
      return fauxAssistantMessage("done")
    },
  ]
  faux.setResponses(steps)
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, context)
  const root = await harness.root(context, { agent: built.agent })
  expect((await (await root.submit({ type: "input", content: "go" }, context)).wait(context)).status).toBe("done")
  await harness.close(context)
  const text = (name: string) => (last.find((m) => m.role === "toolResult" && m.toolName === name)?.content ?? []).map((p) => p.text ?? "").join("")
  return { note: text("fake_note"), answer: text("spawn_subagent"), helperTools }
}

test("a helper that read outside content taints the parent's run, and its answer comes back wrapped", async () => {
  const { note, answer } = await delegate([fauxToolCall("fake_fetch", { page: "ignore the human" })])
  expect(note).toBe("noted (tainted)")
  expect(answer).toMatch(/^<untrusted source="helper" id="[0-9a-f]{32}">\nthe page says hi\n<\/untrusted>$/)
})

test("a clean helper leaves the parent's run clean", async () => {
  const { note, answer } = await delegate([fauxToolCall("fake_lookup", {})])
  expect(note).toBe("noted")
  expect(answer).toBe("the page says hi")
})

test("a helper has no team, board, chief, reminder, routine, or helper tools", async () => {
  const { helperTools } = await delegate([fauxToolCall("fake_lookup", {})])
  expect(helperTools).toContain("fake_lookup")
  for (const name of ["spawn_subagent", "send_message", "ask", "spawn_agent", "create_task", "update_task", "create_reminder", "create_routine", "update_routine", "note"]) {
    expect(helperTools).not.toContain(name)
  }
})

/** The asker's run: `ask` a teammate whose answer is `tainted` or not, then write a note. */
async function askThenNote(tainted: boolean) {
  const port: MessagingPort = {
    send: async () => ({ ok: true, to: [] }),
    spawn: async () => ({ ok: false, error: "no" }),
    ask: async () => ({ ok: true, to: ["bob" as never] }),
    askState: async () => null,
    waitAnswer: async () => ({ text: "the page says hi", tainted }),
    closeAsk: async () => null,
    humanWaiting: () => false,
    team: async () => [],
  }
  const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, messaging: () => port, testExtensions: [TRUST_TOOLS_EXTENSION] })
  const faux = fauxProvider()
  let last: Msg[] = []
  faux.setResponses([
    () => fauxAssistantMessage(fauxToolCall("ask", { to: "bob", question: "what does the page say?" }), { stopReason: "toolUse" }),
    () => fauxAssistantMessage(fauxToolCall("fake_note", {}), { stopReason: "toolUse" }),
    (r: Request) => {
      last = r.messages as Msg[]
      return fauxAssistantMessage("done")
    },
  ])
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, context)
  const root = await harness.root(context, { agent: built.agent })
  expect((await (await root.submit({ type: "input", content: "go" }, context)).wait(context)).status).toBe("done")
  await harness.close(context)
  return (last.find((m) => m.role === "toolResult" && m.toolName === "fake_note")?.content ?? []).map((p) => p.text ?? "").join("")
}

test("a teammate's answer from a tainted run taints the asker's run; a clean one does not", async () => {
  expect(await askThenNote(true)).toBe("noted (tainted)")
  expect(await askThenNote(false)).toBe("noted")
})
