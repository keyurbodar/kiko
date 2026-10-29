import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { JsonValue } from "@earendil-works/chord"
import {
  GenerationTask,
  InboxDoc,
  type Conversation,
  type Harness,
  type TaskInspection,
  type UserInput,
} from "@earendil-works/pi-durable"
import type { JournalStorage } from "./journal"
import { JournalCorrupt } from "./errors"

const context = BACKGROUND_CONTEXT
const RESTART = "kiko.restart"

export type RestartInput = {
  requestId: string
  content: string
  entry: { kind: string; data: Record<string, JsonValue> }
}

export async function rootGeneration(
  harness: Harness,
  root: Conversation,
): Promise<TaskInspection["record"] | undefined> {
  const live = await harness.inspect(context)
  return live.tasks.find(
    ({ record }) => record.conversationId === root.id && record.kind === GenerationTask.definition.name,
  )?.record
}

export async function rememberRestart(root: Conversation, storage: JournalStorage, input: RestartInput): Promise<void> {
  await root.commit((tx) => tx.appendEntry(root.id, { kind: RESTART, data: { ...input } }), context)
  storage.flush()
}

export async function cancelPaused(
  harness: Harness,
  root: Conversation,
  live: Pick<Awaited<ReturnType<Harness["inspect"]>>, "tasks" | "submissions">,
): Promise<void> {
  const conversations = new Set([
    root.id,
    ...live.tasks.map(({ record }) => record.conversationId),
    ...live.submissions.map((submission) => submission.conversationId),
  ])
  await root.commit(async (tx) => {
    const inboxes = await Promise.all([...conversations].map((id) => tx.doc(InboxDoc, id)))
    for (const inbox of inboxes) {
      for (const item of inbox.items) {
        if (item.mode !== "write") tx.settleSubmission(item.id, { status: "unanswered", reason: "aborted" })
      }
      inbox.items = inbox.items.filter((item) => item.mode === "write")
    }
  }, context)
  for (const { record } of live.tasks) await harness.abortTask(record.id, context)
}

type KeptInput = {
  id: string
  content: JsonValue
  entry?: { kind: string; data?: JsonValue }
}

export async function takeQueued(root: Conversation): Promise<KeptInput[]> {
  const kept: KeptInput[] = []
  await root.commit(async (tx) => {
    const inbox = await tx.doc(InboxDoc, root.id)
    for (const item of inbox.items) {
      if (item.mode === "write") continue
      kept.push({
        id: String(item.id),
        content: item.content as JsonValue,
        ...(item.entry ? { entry: item.entry } : {}),
      })
    }
  }, context)
  return kept
}

export async function replayQueued(root: Conversation, kept: readonly KeptInput[], prefix: string): Promise<void> {
  for (const item of kept)
    await root.submit(
      {
        type: "input",
        whenBusy: "steer",
        requestId: `${prefix}:kept:${item.id}`,
        content: item.content as UserInput,
        ...(item.entry ? { entry: item.entry } : {}),
      },
      context,
    )
}

export async function cancelRestart(root: Conversation, storage: JournalStorage): Promise<void> {
  const data = (await root.context(context)).entries.findLast((entry) => entry.kind === RESTART)?.data
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.requestId !== "string") return
  if (await storage.submissionByRequest(root.id, data.requestId, context)) return
  await root.commit((tx) => tx.appendEntry(root.id, { kind: RESTART }), context)
  storage.flush()
}

export async function recoverRestart(root: Conversation, storage: JournalStorage): Promise<void> {
  const { entries } = await root.context(context)
  const cancelled = entries.findLastIndex((entry) => entry.kind === RESTART && entry.data === undefined)
  let abort = true
  for (const entry of entries.slice(cancelled + 1)) {
    if (entry.kind === RESTART && (await replayRestart(root, storage, entry.data, abort))) abort = false
  }
}

async function replayRestart(
  root: Conversation,
  storage: JournalStorage,
  data: JsonValue | undefined,
  abort: boolean,
): Promise<boolean> {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.requestId !== "string" ||
    typeof data.content !== "string"
  )
    return false
  if (await storage.submissionByRequest(root.id, data.requestId, context)) return false
  const entry = data.entry
  if (
    !entry ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    typeof entry.kind !== "string" ||
    !entry.data ||
    typeof entry.data !== "object" ||
    Array.isArray(entry.data)
  )
    throw new JournalCorrupt({ reason: "restart_input", message: "Invalid human restart input" })
  const queued = await storage.scanSubmissions({ conversationId: root.id, status: "queued" }, 1, undefined, context)
  if (abort && !queued.items.length) await root.abort(context)
  await root.submit(
    {
      type: "input",
      whenBusy: "steer",
      requestId: data.requestId,
      content: data.content,
      entry: { kind: entry.kind, data: entry.data },
    },
    context,
  )
  return true
}
