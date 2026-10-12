import { DurableObject } from "cloudflare:workers"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { AssistantEntry, createRegistry, Harness, LiveDoc, ROOT_CONVERSATION_ID, type Storage } from "@earendil-works/pi-durable"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { createStorageConformance, type StorageConformanceProvider } from "@earendil-works/pi-durable/testing"
import { createCoalescingStorage, type HoldPolicy } from "@yuki/agent/coalescing-storage"
import { openDurableObjectSqlite } from "@yuki/agent/sqlite"
import { assertions } from "./sqlite-worker"

const context = BACKGROUND_CONTEXT
const FAUX_MODEL = { provider: "faux", modelId: "faux-1" }
const TOKENS_PER_SECOND = 50

const streamedText = (ms: number) => {
  const chars = Math.round((ms / 1000) * TOKENS_PER_SECOND * 4)
  return "lorem ipsum dolor sit amet ".repeat(Math.ceil(chars / 27)).slice(0, chars)
}

async function openDurable(storage: DurableObjectStorage, coalesce: boolean) {
  const sqlite = await SqliteStorage.open(openDurableObjectSqlite(storage))
  const durable: Storage = coalesce ? createCoalescingStorage(sqlite) : sqlite
  return { durable }
}

function fauxModels(responses: string[]) {
  const faux = fauxProvider({ tokensPerSecond: TOKENS_PER_SECOND })
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses(responses.map((text) => fauxAssistantMessage(text)))
  return models
}

type Message = { content?: { type: string; text?: string }[]; stopReason?: string }
const textOf = (message: Message | undefined) =>
  (message?.content ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("")

async function assistantMessages(harness: Harness) {
  const view = await (await harness.root(context)).context(context)
  return view.entries
    .filter((entry) => entry.kind === AssistantEntry.kind)
    .map((entry) => {
      const message = entry.model?.[0] as Message | undefined
      return { text: textOf(message), stopReason: message?.stopReason }
    })
}

type TurnMeasurement = {
  coalesce: boolean
  status: string
  streamMs: number
  rowsWritten: number
  commits: number
  answerChars: number
}

async function measureTurn(storage: DurableObjectStorage, coalesce: boolean, streamMs = 15_000): Promise<TurnMeasurement> {
  const counted = countRows(storage)
  const { durable } = await openDurable(counted.storage, coalesce)
  let commits = 0
  const counting = new Proxy(durable, {
    get(target, key: keyof Storage) {
      if (key === "commit") {
        return (...args: Parameters<Storage["commit"]>) => {
          commits++
          return target.commit(...args)
        }
      }
      const member = target[key] as unknown
      return typeof member === "function" ? member.bind(target) : member
    },
  })
  const answer = streamedText(streamMs)
  const harness = await Harness.open(counting, { models: fauxModels([answer]), registry: createRegistry() }, context)
  const root = await harness.root(context, { agent: { model: FAUX_MODEL } })
  const rowsBefore = counted.snapshot().rowsWritten
  const commitsBefore = commits
  const started = Date.now()
  const submission = await root.submit({ type: "input", content: "count", requestId: "measure" }, context)
  const settled = await submission.wait(context)
  await harness.waitForIdle(context)
  const elapsed = Date.now() - started
  const rowsWritten = counted.snapshot().rowsWritten - rowsBefore
  const turnCommits = commits - commitsBefore
  const last = (await assistantMessages(harness)).at(-1)
  await harness.close(context)
  return {
    coalesce,
    status: settled.status,
    streamMs: elapsed,
    rowsWritten,
    commits: turnCommits,
    answerChars: last?.text === answer ? answer.length : -1,
  }
}


interface RowCounts {
  rowsRead: number
  rowsWritten: number
  statements: number
}

function countRows(storage: DurableObjectStorage): { storage: DurableObjectStorage; snapshot(): RowCounts } {
  const counts: RowCounts = { rowsRead: 0, rowsWritten: 0, statements: 0 }
  const sql = {
    exec: (query: string, ...bindings: unknown[]) => {
      const cursor = storage.sql.exec(query, ...(bindings as never[]))
      return {
        toArray: () => {
          const rows = cursor.toArray()
          counts.rowsRead += cursor.rowsRead
          counts.rowsWritten += cursor.rowsWritten
          counts.statements += 1
          return rows
        },
      }
    },
  }
  const wrapped = new Proxy(storage, {
    get(target, key) {
      if (key === "sql") return sql
      const value = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { storage: wrapped, snapshot: () => ({ ...counts }) }
}

const fail = (message: string): never => {
  throw new Error(message)
}

const policies: Record<string, HoldPolicy | undefined> = { default: undefined, aggressive: () => true }

const conformance = (storage: DurableObjectStorage, holds: HoldPolicy | undefined) => {
  const provider: StorageConformanceProvider = async (use) => {
    const durable = createCoalescingStorage(await SqliteStorage.open(openDurableObjectSqlite(storage)), { holds })
    try {
      await use(durable)
    } finally {
      await durable.close(context)
    }
  }
  return createStorageConformance({ assertions, withStorage: provider })
}

const CRASH_ANSWER = streamedText(6_000)
const RECOVERED = "recovered answer"
const text = (message: unknown) =>
  ((message as { content?: { type: string; text?: string }[] } | undefined)?.content ?? [])
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("")

type Body =
  | { op: "conformance"; policy: string; index?: number }
  | { op: "measure"; coalesce: boolean; ms: number }
  | { op: "crash" }
  | { op: "resume" }

export class T extends DurableObject {
  async fetch(request: Request) {
    const body = (await request.json()) as Body
    if (body.op === "conformance") {
      const cases = conformance(this.ctx.storage, policies[body.policy])
      if (body.index === undefined) return Response.json({ names: cases.map((c) => c.name) })
      const testCase = cases[body.index] ?? fail(`no case ${body.index}`)
      try {
        await testCase.run()
        return Response.json({ name: testCase.name, ok: true })
      } catch (error) {
        return Response.json({ name: testCase.name, ok: false, error: error instanceof Error ? error.stack : String(error) })
      }
    }
    if (body.op === "measure") return Response.json(await measureTurn(this.ctx.storage, body.coalesce, body.ms))
    if (body.op === "crash") return this.crash()
    return this.resume()
  }

  private async crash(): Promise<Response> {
    const { durable } = await openDurable(this.ctx.storage, true)
    const harness = await Harness.open(durable, { models: fauxModels([CRASH_ANSWER]), registry: createRegistry() }, context)
    const root = await harness.root(context, { agent: { model: FAUX_MODEL } })
    void root.submit({ type: "input", content: "count", requestId: "crash" }, context).catch(() => {})
    const raw = await SqliteStorage.open(openDurableObjectSqlite(this.ctx.storage))
    const address = { kind: LiveDoc.definition.kind, scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID } } as const
    const storedChars = async () => {
      const record = await raw.findDocument(address, "current", context)
      if (!record) return 0
      const stored = (await raw.document(record.id, "current", context))?.value as { generation?: { message?: unknown } } | undefined
      return text(stored?.generation?.message).length
    }
    const deadline = Date.now() + 10_000
    let memoryChars = 0
    let storedCount = 0
    // Crash once something is flushed and the memory holds more than the store: the window is open.
    for (;;) {
      memoryChars = text((await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context))?.generation?.message).length
      storedCount = await storedChars()
      if (storedCount > 0 && memoryChars > storedCount) break
      if (Date.now() > deadline) return Response.json({ error: "no window opened", memoryChars, storedCount }, { status: 500 })
      await scheduler.wait(10)
    }
    await this.ctx.storage.put("crash", { memoryChars, storedChars: storedCount })
    await this.ctx.storage.sync()
    this.ctx.abort("simulated crash")
    return Response.json({ error: "still alive" }, { status: 500 })
  }

  private async resume(): Promise<Response> {
    const info = await this.ctx.storage.get("crash")
    const { durable } = await openDurable(this.ctx.storage, true)
    const harness = await Harness.open(durable, { models: fauxModels([RECOVERED]), registry: createRegistry() }, context)
    harness.resume()
    await harness.waitForIdle(context)
    const messages = await assistantMessages(harness)
    await harness.close(context)
    return Response.json({ info, messages, answer: CRASH_ANSWER, recovered: RECOVERED })
  }
}

export default {
  async fetch() {
    return new Response("not found", { status: 404 })
  },
}
