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
import { type FilesBackend, RoomFs, roomViews } from "../src/files/room-fs"
import type { FsEntry } from "../src/room/files"
import { isRunTainted } from "@yuki/agent/trust"

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

test("two asks in one reply, to two teammates, wait together and each gets its own answer", async () => {
  let waiting = 0
  let peak = 0
  const port: MessagingPort = {
    send: async () => ({ ok: true, to: [] }),
    spawn: async () => ({ ok: false, error: "no" }),
    ask: async (input) => ({ ok: true, to: [input.to as never] }),
    askState: async () => null,
    waitAnswer: async (id) => {
      waiting++
      peak = Math.max(peak, waiting)
      await new Promise((resolve) => setTimeout(resolve, 200))
      waiting--
      return { text: `answer for ${id.split(":").at(-1)}`, tainted: false }
    },
    closeAsk: async () => null,
    humanWaiting: () => false,
    team: async () => [],
  }
  const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, messaging: () => port })
  const faux = fauxProvider()
  let results: string[] = []
  faux.setResponses([
    () =>
      fauxAssistantMessage([fauxToolCall("ask", { to: "ada", question: "which port?" }), fauxToolCall("ask", { to: "bob", question: "which host?" })], { stopReason: "toolUse" }),
    (r: Request) => {
      results = (r.messages as Msg[]).filter((m) => m.role === "toolResult" && m.toolName === "ask").map((m) => (m.content ?? []).map((p) => p.text ?? "").join(""))
      return fauxAssistantMessage("done")
    },
  ])
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, context)
  const root = await harness.root(context, { agent: built.agent })
  expect((await (await root.submit({ type: "input", content: "go" }, context)).wait(context)).status).toBe("done")
  await harness.close(context)
  expect(peak).toBe(2)
  expect(results).toHaveLength(2)
  expect(results.filter((r) => r.startsWith("@ada answered: ")).length).toBe(1)
  expect(results.filter((r) => r.startsWith("@bob answered: ")).length).toBe(1)
})

test("helpers called in one reply run side by side, at most three at a time", async () => {
  const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" } })
  const faux = fauxProvider()
  let running = 0
  let peak = 0
  let answers: string[] = []
  const firstInput = (r: Request) => JSON.stringify((r.messages as Msg[]).find((m) => m.role === "user")?.content ?? "")
  const step = async (r: Request) => {
    const messages = r.messages as Msg[]
    if (!firstInput(r).includes("task ")) {
      const results = messages.filter((m) => m.role === "toolResult" && m.toolName === "spawn_subagent")
      if (results.length === 0) {
        return fauxAssistantMessage([1, 2, 3, 4].map((n) => fauxToolCall("spawn_subagent", { task: `task ${n}` })), { stopReason: "toolUse" })
      }
      answers = results.map((m) => (m.content ?? []).map((p) => p.text ?? "").join(""))
      return fauxAssistantMessage("done")
    }
    running++
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 50))
    running--
    return fauxAssistantMessage(`answer to ${/task \d/.exec(firstInput(r))![0]}`)
  }
  faux.setResponses(Array.from({ length: 6 }, () => step))
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, context)
  const root = await harness.root(context, { agent: built.agent })
  expect((await (await root.submit({ type: "input", content: "go" }, context)).wait(context)).status).toBe("done")
  await harness.close(context)
  expect(peak).toBe(3)
  expect(answers.sort()).toEqual(["answer to task 1", "answer to task 2", "answer to task 3", "answer to task 4"])
})

test("a helper call waiting for a slot leaves the queue when its run is aborted, and the slots are all free afterwards", async () => {
  const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" } })
  const faux = fauxProvider()
  const wait = <T>(p: Promise<T>, ms = 3000) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`still waiting after ${ms} ms`)), ms))])
  const started: string[] = []
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let firstThree!: () => void
  const threeHeld = new Promise<void>((resolve) => (firstThree = resolve))
  let freshStarted = 0
  let freshAll!: () => void
  const freshMeet = new Promise<void>((resolve) => (freshAll = resolve))
  const text = (m: Msg) => JSON.stringify(m.content ?? "")
  const step = async (r: Request) => {
    const messages = r.messages as Msg[]
    const first = text(messages.find((m) => m.role === "user")!)
    const task = /task \w+/.exec(first)?.[0]
    if (task === undefined) {
      const last = messages.map((m) => m.role).lastIndexOf("user")
      const again = text(messages[last]!).includes("again")
      if (messages.slice(last).some((m) => m.role === "toolResult")) return fauxAssistantMessage("done")
      const tasks = again ? ["task f1", "task f2", "task f3"] : ["task a1", "task a2", "task a3", "task a4"]
      return fauxAssistantMessage(tasks.map((t) => fauxToolCall("spawn_subagent", { task: t })), { stopReason: "toolUse" })
    }
    started.push(task)
    if (task.startsWith("task f")) {
      if (++freshStarted === 3) freshAll()
      await freshMeet
      return fauxAssistantMessage("fresh answer")
    }
    if (started.filter((t) => t.startsWith("task a")).length === 3) firstThree()
    await held
    return fauxAssistantMessage("late answer")
  }
  faux.setResponses(Array.from({ length: 30 }, () => step))
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, context)
  const root = await harness.root(context, { agent: built.agent })
  const run = await root.submit({ type: "input", content: "go" }, context)
  await wait(threeHeld)
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(started.sort()).toEqual(["task a1", "task a2", "task a3"])

  // The abort waits for the busy helpers, so let it reach the run first, then free them: slots open while the run is going down.
  const aborting = root.abort(context)
  await new Promise((resolve) => setTimeout(resolve, 100))
  release()
  await wait(aborting)
  expect((await wait(run.wait(context))).status).not.toBe("done")
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(started.filter((t) => t === "task a4")).toEqual([])

  // The aborted run's three slots and its waiting call are all gone: three new helpers start together.
  const again = await root.submit({ type: "input", content: "again" }, context)
  expect((await wait(again.wait(context))).status).toBe("done")
  expect(started.filter((t) => t.startsWith("task f")).sort()).toEqual(["task f1", "task f2", "task f3"])
  expect(started).not.toContain("task a4")
  await harness.close(context)
})

/** The chat's files in a map, with the room's rule: a write names the hash it read there, or "none". */
function strictFiles() {
  const files = new Map<string, string>()
  const entry = (path: string): FsEntry & { kind: "file" } => ({ kind: "file", path, id: path, size: files.get(path)!.length, type: "text/plain", sha256: `sha:${files.get(path)}`, r2Key: `key:${path}`, at: 0 })
  const backend: FilesBackend = {
    stat: async (path) => (files.has(path) ? entry(path) : null),
    list: async () => [],
    bytes: async (key) => (files.has(key.slice(4)) ? new TextEncoder().encode(files.get(key.slice(4))!) : null),
    write: async (path, bytes, _type, expect) => {
      if (expect !== undefined && (files.has(path) ? entry(path).sha256 : "none") !== expect) return { ok: false, code: "conflict", message: `${path} holds other bytes` }
      files.set(path, new TextDecoder().decode(bytes))
      return { ok: true, entry: entry(path) }
    },
    move: async () => ({ ok: false, code: "invalid", message: "no" }),
    remove: async () => ({ ok: false, code: "invalid", message: "no" }),
    mkdir: async () => ({ ok: false, code: "invalid", message: "no" }),
    commit: async () => ({ ok: true }),
  }
  return { files, backend }
}

/**
 * The parent sends two helpers at once. Each runs `script`: its tool calls, one per turn, then an
 * answer. Both reach the turn at `meet` before either goes on, so their calls there race. Returns
 * each helper's tool results.
 */
async function race(backend: FilesBackend, script: (task: string) => ReturnType<typeof fauxToolCall>[], meet: number) {
  const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, files: { fs: new RoomFs("t", backend), acceptsImages: () => false } })
  const views = roomViews("t", backend, (conversationId) => isRunTainted({ registry: built.registry.snapshot(), conversationId }))
  const faux = fauxProvider()
  const results = new Map<string, string[]>()
  let arrived = 0
  let open!: () => void
  const met = new Promise<void>((resolve) => (open = resolve))
  const taskOf = (r: Request) => /task [ab]/.exec(JSON.stringify((r.messages as Msg[]).find((m) => m.role === "user")?.content ?? ""))?.[0]
  const step = async (r: Request) => {
    const messages = r.messages as Msg[]
    const done = messages.filter((m) => m.role === "toolResult")
    const task = taskOf(r)
    if (!task) {
      if (done.length) return fauxAssistantMessage("done")
      return fauxAssistantMessage(["task a", "task b"].map((t) => fauxToolCall("spawn_subagent", { task: t })), { stopReason: "toolUse" })
    }
    if (done.length === meet && ++arrived === 2) open()
    if (done.length === meet) await met
    const calls = script(task)
    if (done.length < calls.length) return fauxAssistantMessage(calls[done.length]!, { stopReason: "toolUse" })
    results.set(task, done.map((m) => (m.content ?? []).map((p) => p.text ?? "").join("")))
    return fauxAssistantMessage("finished")
  }
  faux.setResponses(Array.from({ length: 12 }, () => step))
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry, env: (target) => views(target.conversationId) }, context)
  const root = await harness.root(context, { agent: built.agent })
  expect((await (await root.submit({ type: "input", content: "go" }, context)).wait(context)).status).toBe("done")
  await harness.close(context)
  return [...results.values()]
}

test("two helpers that create the same file at once: the first lands, the second is refused and told to read it", async () => {
  const { files, backend } = strictFiles()
  const out = await race(backend, (task) => [fauxToolCall("write", { path: "/logo.svg", content: task })], 0)
  const refused = out.filter(([r]) => r!.includes("already exists, and you have not read it"))
  expect(refused).toHaveLength(1)
  expect(["task a", "task b"]).toContain(files.get("logo.svg")!)
})

test("two helpers that read a file and both rewrite it: the second is refused, so the first one's change is kept", async () => {
  const { files, backend } = strictFiles()
  files.set("copy.md", "v1")
  const out = await race(backend, (task) => [fauxToolCall("read", { path: "/copy.md" }), fauxToolCall("write", { path: "/copy.md", content: task })], 1)
  const refused = out.filter((r) => r[1]!.includes("changed since you last read it"))
  expect(refused).toHaveLength(1)
  const kept = out.find((r) => !r[1]!.includes("changed since"))!
  expect(kept[1]).not.toContain("changed")
  expect(["task a", "task b"]).toContain(files.get("copy.md")!)
})
