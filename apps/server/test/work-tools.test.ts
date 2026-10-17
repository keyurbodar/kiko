import { expect, test } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { type ConversationId, Harness, MemoryStorage } from "@earendil-works/pi-durable"
import type { Envelope } from "@kiko/agent/envelope"
import { WORKERS_RUN, WORKERS_STEPS, WORKERS_TAIL, Workers } from "@kiko/agent/workers"
import type { MemoryPort } from "@kiko/memory/tools"
import { sqlWith } from "./sql-shim"
import { FAKE_TOOLS_EXTENSION } from "../src/agent/dev-fake"
import type { MessagingPort } from "../src/agent/extensions/messaging"
import type { RoutinesPort } from "../src/agent/extensions/routines"
import type { WorkspacePort } from "../src/agent/extensions/workspace"
import { buildAgent } from "../src/agent/factory"
import { type FilesBackend, RoomFs, roomViews } from "../src/files/room-fs"
import type { FsEntry } from "../src/room/files"

const context = BACKGROUND_CONTEXT
type Msg = { role: string; toolName?: string; content?: { type: string; text?: string }[] }
type Request = { messages: readonly unknown[] }

function registry() {
  const reports: Envelope[] = []
  const workers = new Workers({ sql: sqlWith([...WORKERS_STEPS, ...WORKERS_TAIL, ...WORKERS_RUN]) } as unknown as DurableObjectStorage, { deliver: async (e) => void reports.push(e) })
  return { workers, reports }
}

async function until(test: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const toolNames = (r: Request) => [...JSON.stringify((r.messages as Msg[]).filter((m) => m.role === "system")).matchAll(/"name":"([\w-]+)","description"/g)].map((m) => m[1]!)
const isWorker = (r: Request) => !toolNames(r).includes("start_work")

test("a worker gets the agent's tools but no chat, notes, routines, board, or more workers, and its report comes back", async () => {
  const workspace: WorkspacePort = { call: async () => ({ ok: true, text: "ok" }) }
  const routines = { port: () => null as RoutinesPort | null, tz: () => "UTC" }
  const messaging = () => ({}) as MessagingPort
  const memory: MemoryPort = { note: async () => ({ ok: true }) as never, recall: async () => "", zoom: async () => null, captures: () => false }
  const { workers, reports } = registry()
  const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, workspace, routines, messaging, memory, work: workers, testExtensions: [FAKE_TOOLS_EXTENSION] })
  const faux = fauxProvider()
  let talkerTools: string[] = []
  let workerTools: string[] = []
  const step = (r: Request) => {
    const messages = r.messages as Msg[]
    if (isWorker(r)) {
      workerTools = toolNames(r)
      if (!messages.some((m) => m.role === "toolResult")) return fauxAssistantMessage(fauxToolCall("fake_lookup", {}), { stopReason: "toolUse" })
      return fauxAssistantMessage("the page says hi")
    }
    talkerTools = toolNames(r)
    if (messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("on it")
    return fauxAssistantMessage(fauxToolCall("start_work", { task: "look it up" }), { stopReason: "toolUse" })
  }
  faux.setResponses(Array.from({ length: 6 }, () => step))
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, context)
  workers.rearm(harness)
  const root = await harness.root(context, { agent: built.agent })
  expect((await (await root.submit({ type: "input", content: "go" }, context)).wait(context)).status).toBe("done")
  await until(() => reports.length === 1)
  await harness.close(context)
  expect(reports[0]).toMatchObject({ id: "work:w1:" + workers.get("w1")!.submissionId, body: "the page says hi", work: { id: "w1", status: "done" } })
  expect(workers.get("w1")!.step).toBe("fake_lookup")
  expect(workerTools).toContain("fake_lookup")
  const withheld = ["start_work", "steer_work", "stop_work", "send_message", "ask", "create_task", "update_task", "create_routine", "cancel_routine", "update_routine", "note"]
  for (const name of withheld) {
    expect(talkerTools).toContain(name)
    expect(workerTools).not.toContain(name)
  }
})

test("two asks in one reply, to two teammates, wait together and each gets its own answer", async () => {
  let waiting = 0
  let peak = 0
  const port: MessagingPort = {
    send: async () => ({ ok: true, to: [] }),
    ask: async (input) => ({ ok: true, to: [input.to as never] }),
    askState: async () => null,
    waitAnswer: async (id) => {
      waiting++
      peak = Math.max(peak, waiting)
      await new Promise((resolve) => setTimeout(resolve, 200))
      waiting--
      return `answer for ${id.split(":").at(-1)}`
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

async function race(backend: FilesBackend, script: (task: string) => ReturnType<typeof fauxToolCall>[], meet: number) {
  const { workers, reports } = registry()
  const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, work: workers, files: { fs: new RoomFs("t", backend), acceptsImages: () => false } })
  const views = roomViews("t", backend)
  const faux = fauxProvider()
  const results = new Map<string, string[]>()
  let arrived = 0
  let open!: () => void
  const met = new Promise<void>((resolve) => (open = resolve))
  const taskOf = (r: Request) => /task [ab]/.exec(JSON.stringify((r.messages as Msg[]).find((m) => m.role === "user")?.content ?? ""))?.[0]
  const step = async (r: Request) => {
    const messages = r.messages as Msg[]
    const done = messages.filter((m) => m.role === "toolResult")
    if (!isWorker(r)) {
      if (done.length) return fauxAssistantMessage("on it")
      return fauxAssistantMessage(["task a", "task b"].map((t) => fauxToolCall("start_work", { task: t })), { stopReason: "toolUse" })
    }
    const task = taskOf(r)!
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
  workers.rearm(harness)
  const root = await harness.root(context, { agent: built.agent })
  expect((await (await root.submit({ type: "input", content: "go" }, context)).wait(context)).status).toBe("done")
  await until(() => reports.length === 2)
  await harness.close(context)
  return [...results.values()]
}

test("two workers that create the same file at once: the first lands, the second is refused and told to read it", async () => {
  const { files, backend } = strictFiles()
  const out = await race(backend, (task) => [fauxToolCall("write", { path: "/logo.svg", content: task })], 0)
  const refused = out.filter(([r]) => r!.includes("already exists, and you have not read it"))
  expect(refused).toHaveLength(1)
  expect(["task a", "task b"]).toContain(files.get("logo.svg")!)
})

test("two workers that read a file and both rewrite it: the second is refused, so the first one's change is kept", async () => {
  const { files, backend } = strictFiles()
  files.set("copy.md", "v1")
  const out = await race(backend, (task) => [fauxToolCall("read", { path: "/copy.md" }), fauxToolCall("write", { path: "/copy.md", content: task })], 1)
  const refused = out.filter((r) => r[1]!.includes("changed since you last read it"))
  expect(refused).toHaveLength(1)
  const kept = out.find((r) => !r[1]!.includes("changed since"))!
  expect(kept[1]).not.toContain("changed")
  expect(["task a", "task b"]).toContain(files.get("copy.md")!)
})

test("the talker's start_work takes one whole job per worker, so a many-part job is not one worker per part", () => {
  const { workers } = registry()
  const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, work: workers })
  const startWork = built.agent.extensions.flatMap((e) => e.tools ?? []).find((t) => t.name === "start_work")
  expect(startWork?.description).toMatch(/one background worker for a whole job/)
  expect(startWork?.description).toMatch(/never one worker per part/)
})
