import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { JsonValue } from "@earendil-works/chord"
import { GenerationTask, ToolTask, type Conversation, type Harness, type RegistryReader, type TaskId } from "@earendil-works/pi-durable"
import { stoppable } from "./effects"
import type { JournalStorage } from "./journal"

const context = BACKGROUND_CONTEXT
const RESTART = "kiko.restart"
export const RESTARTS_KEY = "mid-run:restarts"

export type RestartInput = { requestId: string; content: string; entry: { kind: string; data: Record<string, JsonValue> } }

export async function generationStarted(harness: Harness, root: Conversation): Promise<boolean> {
  const live = await harness.inspect(context)
  return live.tasks.some(({ record }) => record.conversationId === root.id && record.kind === GenerationTask.definition.name && record.startedAt !== undefined)
}

export async function rememberRestart(root: Conversation, storage: JournalStorage, input: RestartInput, restarts: number): Promise<void> {
  await root.commit((tx) => tx.appendEntry(root.id, { kind: RESTART, data: { ...input, restarts } }), context)
  storage.flush()
}

export async function cancelRestart(root: Conversation, storage: JournalStorage): Promise<void> {
  const data = (await root.context(context)).entries.findLast((entry) => entry.kind === RESTART)?.data
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.requestId !== "string") return
  if (await storage.submissionByRequest(root.id, data.requestId, context)) return
  await root.commit((tx) => tx.appendEntry(root.id, { kind: RESTART }), context)
  storage.flush()
}

export async function recoverRestart(root: Conversation, storage: JournalStorage, durable: DurableObjectStorage): Promise<void> {
  const { entries } = await root.context(context)
  const cancelled = entries.findLastIndex((entry) => entry.kind === RESTART && entry.data === undefined)
  let abort = true
  for (const entry of entries.slice(cancelled + 1)) {
    if (entry.kind === RESTART && await replayRestart(root, storage, durable, entry.data, abort)) abort = false
  }
}

async function replayRestart(root: Conversation, storage: JournalStorage, durable: DurableObjectStorage, data: JsonValue | undefined, abort: boolean): Promise<boolean> {
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.requestId !== "string" || typeof data.content !== "string" || typeof data.restarts !== "number") return false
  if (await storage.submissionByRequest(root.id, data.requestId, context)) return false
  const entry = data.entry
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.kind !== "string" || !entry.data || typeof entry.data !== "object" || Array.isArray(entry.data)) throw new Error("Invalid human restart input")
  const queued = await storage.scanSubmissions({ conversationId: root.id, status: "queued" }, 1, undefined, context)
  if (abort && !queued.items.length) {
    if (await durable.get<number>(RESTARTS_KEY) !== data.restarts) await durable.put(RESTARTS_KEY, data.restarts)
    await root.abort(context)
  }
  await root.submit({ type: "input", whenBusy: "steer", requestId: data.requestId, content: data.content, entry: { kind: entry.kind, data: entry.data } }, context)
  return true
}

export async function stoppableTools(harness: Harness, root: Conversation, registry: RegistryReader, tools: ReadonlyMap<string, string>): Promise<TaskId[]> {
  const live = await harness.inspect(context)
  const installed = registry.snapshot().tools()
  const ids: TaskId[] = []
  for (const { record, state } of live.tasks) {
    if (record.kind !== ToolTask.definition.name || record.conversationId !== root.id || state.kind !== "running") continue
    const input = record.input
    if (!input || typeof input !== "object" || Array.isArray(input) || input.kind !== "model" || typeof input.callId !== "string") continue
    const name = tools.get(input.callId)
    const tool = installed.find((t) => t.tool.name === name)?.tool
    if (tool && stoppable(tool)) ids.push(record.id)
  }
  return ids
}
