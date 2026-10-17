import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import type { AgentSetup, HostOptions } from "@kiko/agent/host"
import type { Envelope } from "@kiko/protocol"
import { AgentDO } from "../src/agent/agent-do"
import { buildAgent } from "../src/agent/factory"
import type { RoomPort } from "../src/agent/outbox"
import { type FilesBackend, RoomFs, roomViews } from "../src/files/room-fs"
import type { FsEntry } from "../src/room/files"

// While a gate is shut, every commit waits at it and counts itself as held: a test stops a worker in the middle of a save.
let gate: Promise<void> | null = null
let openGate = () => {}
let held = 0

// The chat's files in memory, so a worker's write or bash command lands where the test can see it.
function memoryFiles(): FilesBackend {
  const files = new Map<string, string>()
  const entry = (path: string): FsEntry & { kind: "file" } => ({ kind: "file", path, id: path, size: files.get(path)!.length, type: "text/plain", sha256: `sha:${files.get(path)}`, r2Key: `key:${path}`, at: 0 })
  const apply = (path: string, bytes: Uint8Array) => void files.set(path, new TextDecoder().decode(bytes))
  const refused = { ok: false as const, code: "invalid", message: "not in this test" }
  return {
    stat: async (path) => (files.has(path) ? entry(path) : null),
    list: async () => [],
    bytes: async (key) => (files.has(key.slice(4)) ? new TextEncoder().encode(files.get(key.slice(4))!) : null),
    write: async (path, bytes) => {
      apply(path, bytes)
      return { ok: true, entry: entry(path) }
    },
    move: async () => refused,
    remove: async () => refused,
    mkdir: async () => refused,
    commit: async (changes) => {
      if (gate) {
        held++
        await gate
      }
      for (const c of changes) if (c.op === "write") apply(c.path, c.bytes)
      return { ok: true }
    },
  }
}

const context = BACKGROUND_CONTEXT

type Part = { type: string; text?: string; name?: string }
type Msg = { role: string; toolName?: string; content?: string | Part[] }
const textOf = (m: Msg | undefined) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join(""))
const bare = (text: string) => text.replace(/<context>[\s\S]*?<\/context>\s*/g, "").trim()

const hanging = new Map<string, Set<() => void>>()

type Body =
  | { op: "receive"; envelopes: Envelope[] }
  | { op: "posts" }
  | { op: "hangs" }
  | { op: "release" }
  | { op: "requests" }
  | { op: "transcript" }
  | { op: "workers" }
  | { op: "status" }
  | { op: "crash" }
  | { op: "repeat" }
  | { op: "gate" }
  | { op: "ungate" }
  | { op: "held" }

export class T extends AgentDO {
  protected override readonly hostOptions: Partial<HostOptions> = {
    heartbeatMs: 500,
    onOpen: async () => {
      await this.ctx.storage.put("opens", ((await this.ctx.storage.get<number>("opens")) ?? 0) + 1)
    },
  }

  private get waiters(): Set<() => void> {
    const id = this.ctx.id.toString()
    if (!hanging.has(id)) hanging.set(id, new Set())
    return hanging.get(id)!
  }

  private table(): SqlStorage {
    const sql = this.ctx.storage.sql
    sql.exec("CREATE TABLE IF NOT EXISTS t_posts (n INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT NOT NULL, idx INTEGER NOT NULL, text TEXT NOT NULL, UNIQUE (run, idx))")
    sql.exec("CREATE TABLE IF NOT EXISTS t_requests (n INTEGER PRIMARY KEY AUTOINCREMENT, worker INTEGER NOT NULL, roles TEXT NOT NULL, users TEXT NOT NULL)")
    return sql
  }

  private async bump(key: string): Promise<void> {
    await this.ctx.storage.put(key, ((await this.ctx.storage.get<number>(key)) ?? 0) + 1)
  }

  protected override roomPort(): RoomPort {
    return {
      post: async (runId, _attempt, index, block) => {
        this.table().exec("INSERT OR REPLACE INTO t_posts (run, idx, text) VALUES (?, ?, ?)", runId, index, block)
      },
      draft: async () => {},
      note: async () => {},
      status: async () => {},
      workers: async () => {},
      endRun: async () => {},
      react: async () => {},
    }
  }

  protected override async setup(): Promise<AgentSetup> {
    const hang = declareEffect(
      "read",
      defineTool({
        name: "hang",
        description: "waits until the test releases it.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async (_args, _api, ctx) => {
          await this.bump("hang:started")
          if (!(await this.ctx.storage.get<boolean>("released"))) {
            await new Promise<void>((resolve, reject) => {
              this.waiters.add(resolve)
              ctx.abortSignal?.addEventListener(
                "abort",
                () => {
                  this.waiters.delete(resolve)
                  void this.bump("hang:aborted").then(() => reject(ctx.abortSignal?.reason ?? new Error("aborted")))
                },
                { once: true },
              )
            })
          }
          return { output: [{ type: "text", text: "released" }] }
        },
      }),
    )
    const step = (request: { messages: readonly unknown[] }) => {
      const all = request.messages as Msg[]
      const talker = JSON.stringify(all.filter((m) => m.role === "system")).includes('"start_work"')
      const messages = all.filter((m) => m.role !== "system")
      const users = messages.filter((m) => m.role === "user").map((m) => bare(textOf(m)))
      this.table().exec("INSERT INTO t_requests (worker, roles, users) VALUES (?, ?, ?)", talker ? 0 : 1, JSON.stringify(messages.map((m) => m.role)), JSON.stringify(users))
      const last = messages.at(-1)
      if (!talker) {
        // A task that says WRITE writes two files first, one write each; BASH writes the same two files with one command. Then it hangs.
        const first = users[0] ?? ""
        const writes: ReturnType<typeof fauxToolCall>[] = first.includes("WRITE") ? [fauxToolCall("write", { path: "/a.txt", content: "x" }), fauxToolCall("write", { path: "/b.txt", content: "x" })] : []
        if (first.includes("BASH")) writes.push(fauxToolCall("bash", { command: "echo x > /a.txt && echo x > /b.txt" }))
        const calls = messages.filter((m) => m.role === "toolResult").length
        if (calls < writes.length) return fauxAssistantMessage(writes[calls]!, { stopReason: "toolUse" })
        if (calls === writes.length) return fauxAssistantMessage(fauxToolCall("hang", {}), { stopReason: "toolUse" })
        return fauxAssistantMessage(`worker answer; heard=${users.join(" | ")}`)
      }
      if (last?.role === "toolResult") {
        const results = messages.slice(messages.findLastIndex((m) => m.role === "assistant") + 1).map(textOf)
        return fauxAssistantMessage(`tools said: ${results.join(" || ")}`)
      }
      const turn = bare(textOf(last))
      const work = /<work id="(\w+)" status="(\w+)">([\s\S]*?)<\/work>/.exec(turn)
      if (work) return fauxAssistantMessage(`reported ${work[1]} ${work[2]}: ${work[3]!.trim()}`)
      if (turn.startsWith("START4")) return fauxAssistantMessage([1, 2, 3, 4].map((n) => fauxToolCall("start_work", { task: `job ${n}` })), { stopReason: "toolUse" })
      const start = /^START (.*)$/.exec(turn)
      if (start) return fauxAssistantMessage(fauxToolCall("start_work", { task: start[1]! }), { stopReason: "toolUse" })
      const steer = /^STEER (.*)$/.exec(turn)
      if (steer) return fauxAssistantMessage(fauxToolCall("steer_work", { id: "w1", text: steer[1]! }), { stopReason: "toolUse" })
      if (turn === "STOP") return fauxAssistantMessage(fauxToolCall("stop_work", { id: "w1" }), { stopReason: "toolUse" })
      return fauxAssistantMessage(`reply to: ${turn}`)
    }
    const faux = fauxProvider()
    faux.setResponses(Array.from({ length: 300 }, () => step))
    const models = createModels()
    models.setProvider(faux.provider)
    const backend = memoryFiles()
    const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, work: this.host.workers, files: { fs: new RoomFs("workers", backend), acceptsImages: () => false }, testExtensions: [defineExtension({ name: "test-hang", tools: [hang] })] })
    return { models, ...built, env: roomViews("workers", backend), beginRun: async () => true }
  }

  override async fetch(request: Request) {
    const body = (await request.json()) as Body
    if (body.op === "receive") return Response.json(await this.receive(body.envelopes, ""))
    if (body.op === "posts") return Response.json(this.table().exec<{ text: string }>("SELECT text FROM t_posts ORDER BY n").toArray().map((r) => r.text))
    if (body.op === "requests") {
      const rows = this.table().exec<{ worker: number; roles: string; users: string }>("SELECT worker, roles, users FROM t_requests ORDER BY n").toArray()
      return Response.json(rows.map((r) => ({ worker: r.worker === 1, roles: JSON.parse(r.roles) as string[], users: JSON.parse(r.users) as string[] })))
    }
    if (body.op === "hangs") {
      const get = async (key: string) => (await this.ctx.storage.get<number>(key)) ?? 0
      return Response.json({ started: await get("hang:started"), aborted: await get("hang:aborted"), waiting: this.waiters.size })
    }
    if (body.op === "gate") {
      gate = new Promise((resolve) => (openGate = resolve))
      held = 0
      return Response.json({ ok: true })
    }
    if (body.op === "ungate") {
      openGate()
      gate = null
      return Response.json({ ok: true })
    }
    if (body.op === "held") return Response.json(held)
    if (body.op === "release") {
      await this.ctx.storage.put("released", true)
      for (const resolve of this.waiters) resolve()
      this.waiters.clear()
      return Response.json({ ok: true })
    }
    if (body.op === "workers") return Response.json(this.host.workers.list().map((w) => ({ ...w, changed: this.host.workers.changedPaths(w.id).paths })))
    if (body.op === "status") return Response.json({ ...(await this.status()), opens: (await this.ctx.storage.get<number>("opens")) ?? 0 })
    if (body.op === "repeat") {
      this.ctx.storage.sql.exec("UPDATE workers SET delivered = 0")
      this.host.workers.rearm((await this.host.open()).harness)
      return Response.json({ ok: true })
    }
    if (body.op === "crash") {
      this.waiters.clear()
      await this.ctx.storage.sync()
      this.ctx.abort("simulated crash")
      return Response.json({ error: "still alive" }, { status: 500 })
    }
    const { root } = await this.host.open()
    const view = await root.context(context)
    const of = (kind: string) => view.entries.filter((e) => e.kind === kind).map((e) => textOf(e.model?.[0] as Msg | undefined))
    return Response.json({ users: of("pi.user"), assistants: of("pi.assistant") })
  }
}

export default {
  async fetch() {
    return new Response("not found", { status: 404 })
  },
}
