import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { AssistantEntry, createRegistry, Harness, type Storage } from "@earendil-works/pi-durable"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { type CoalescingStorage, createCoalescingStorage } from "@yuki/agent/coalescing-storage"
import { openDurableObjectSqlite } from "@yuki/agent/sqlite"
import type { Env } from "../index"
import { countRows } from "./count-rows"

const context = BACKGROUND_CONTEXT
export const FAUX_MODEL = { provider: "faux", modelId: "faux-1" }
export const TOKENS_PER_SECOND = 50

export const streamedText = (ms: number) => {
  const chars = Math.round((ms / 1000) * TOKENS_PER_SECOND * 4)
  return "lorem ipsum dolor sit amet ".repeat(Math.ceil(chars / 27)).slice(0, chars)
}

export async function openDurable(storage: DurableObjectStorage, coalesce: boolean) {
  const sqlite = await SqliteStorage.open(openDurableObjectSqlite(storage))
  const durable: Storage = coalesce ? createCoalescingStorage(sqlite) : sqlite
  return { durable, coalescing: coalesce ? (durable as CoalescingStorage) : undefined }
}

export function fauxModels(responses: string[]) {
  const faux = fauxProvider({ tokensPerSecond: TOKENS_PER_SECOND })
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses(responses.map((text) => fauxAssistantMessage(text)))
  return models
}

type Message = { content?: { type: string; text?: string }[]; stopReason?: string }
const textOf = (message: Message | undefined) =>
  (message?.content ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("")

export async function assistantMessages(harness: Harness) {
  const view = await (await harness.root(context)).context(context)
  return view.entries
    .filter((entry) => entry.kind === AssistantEntry.kind)
    .map((entry) => {
      const message = entry.model?.[0] as Message | undefined
      return { text: textOf(message), stopReason: message?.stopReason }
    })
}

export type TurnMeasurement = {
  coalesce: boolean
  status: string
  streamMs: number
  rowsWritten: number
  commits: number
  held: number
  answerChars: number
}

export async function measureTurn(storage: DurableObjectStorage, coalesce: boolean, streamMs = 15_000): Promise<TurnMeasurement> {
  const counted = countRows(storage)
  const { durable, coalescing } = await openDurable(counted.storage, coalesce)
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
  const held = coalescing?.stats().held ?? 0
  const last = (await assistantMessages(harness)).at(-1)
  await harness.close(context)
  return {
    coalesce,
    status: settled.status,
    streamMs: elapsed,
    rowsWritten,
    commits: turnCommits,
    held,
    answerChars: last?.text === answer ? answer.length : -1,
  }
}

declare const process: { env: { NODE_ENV?: string } }

export async function experimentCoalescingRoute(request: Request, env: Env): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return new Response("not found", { status: 404 })
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 })
  const params = new URL(request.url).searchParams
  const coalesce = params.get("coalesce") === "1"
  const ms = Math.min(Math.max(Number(params.get("ms") ?? 15_000) || 15_000, 500), 60_000)
  const stub = env.AGENT.get(env.AGENT.newUniqueId())
  return Response.json(await stub.experimentCoalescing(coalesce, ms))
}
