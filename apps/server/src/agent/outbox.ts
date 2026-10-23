import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import {
  type AgentEvent,
  type Conversation,
  type EntryRecord,
  type Harness,
  type SnapshotEvent,
  type SubmissionId,
  type Storage,
  watchEvents,
} from "@earendil-works/pi-durable"
import type { AgentState, RunErrorKind, WorkerRow } from "@kiko/protocol"
import type { JournalStorage } from "@kiko/agent/journal"
import type { RunProgress } from "@kiko/agent/mid-run"
import { classifyRunError, runErrorDetail } from "./run-error"
import { retrying } from "./retry"
import { type Assistant, ackOf, hasToolCall, noteOf, postOf } from "./pacing"
import { scrubToolMarkup } from "./tool-markup"
import { createSplitter, type Reaction, type Splitter } from "./split-bubbles"

const context = BACKGROUND_CONTEXT
export const DRAFT_INTERVAL_MS = 300

export interface RoomPort {
  post(runId: string, attempt: number, index: number, block: string): Promise<unknown>
  draft(runId: string, index: number, text: string): Promise<void>
  note(runId: string, id: string, text: string): Promise<void>
  status(state: AgentState, detail?: string | null): Promise<void>
  workers(rows: readonly WorkerRow[]): Promise<void>
  endRun(runId: string, inputs?: readonly SubmissionId[], working?: boolean): Promise<void>
  react(deliveryId: string, emoji: string, messageId?: string): Promise<unknown>
  runError(runId: string, error: { kind: RunErrorKind; provider: string; detail?: string }): Promise<void>
}

type Row = { run_id: string; attempt: number; cursor: number; posted: number; until?: number }

type Failure = { errorMessage?: string; provider?: string }

type AssistantLike = Assistant

export function textOf(message: AssistantLike | undefined, final = true): string {
  return (message?.content ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [scrubToolMarkup(part.text, final)] : []))
    .join("\n\n")
}

function partsOf(text: string): { blocks: string[]; reactions: Reaction[] } {
  const splitter = createSplitter()
  const head = splitter.push(text)
  const tail = splitter.end()
  return { blocks: [...head.blocks, ...tail.blocks], reactions: [...head.reactions, ...tail.reactions] }
}

const assistant = (entry: EntryRecord): AssistantLike | undefined => {
  const message = entry.model?.[0] as AssistantLike | undefined
  return message?.role === "assistant" ? message : undefined
}

type Generation = {
  reactionIndex: number
  texts: Map<number, string>
  fed: string
  splitter: Splitter
  blocks: string[]
}

const newGeneration = (): Generation => ({
  reactionIndex: 0,
  texts: new Map(),
  fed: "",
  splitter: createSplitter(),
  blocks: [],
})

type Run = {
  id: string
  attempt: number
  cursor: number
  blocks: string[]
  posted: number
  reactions: (Reaction & { deliveryId: string })[]
  generationIndex: number
  generation: Generation | null
  bubbled: boolean
  toolStarted: boolean
  tools: Map<string, string>
  quiet: boolean
  notes: { id: string; text: string }[]
  failure: Failure | null
}

const quietInput = (entry: EntryRecord): boolean => {
  const content = (entry.model?.[0] as { content?: string | readonly { text?: string }[] } | undefined)?.content
  const text = typeof content === "string" ? content : (content ?? []).map((p) => p.text ?? "").join("\n")
  return text.includes("<system-event") && !text.includes("<context>message id")
}

const noteId = (entry: number) => `note:${entry}`

export class Outbox {
  private readonly sql: SqlStorage
  private journal?: JournalStorage
  private conversationId?: Parameters<typeof watchEvents>[1]
  private run: Run | null = null
  private lastEntry = 0
  private lastDraft = 0
  private state: AgentState = "idle"
  private detail: string | undefined
  private backgroundRunning = false
  private readonly idleWaiters = new Set<{ entry: number; resolve(): void; reject(error: Error): void }>()

  constructor(
    storage: DurableObjectStorage,
    private readonly room: () => RoomPort | null,
    private readonly prefix: () => string,
    private readonly now: () => number = Date.now,
    private readonly agent: string,
  ) {
    this.sql = storage.sql
  }

  private replayEntries(
    run: Run,
    row: Row,
    entries: SnapshotEvent["entries"],
    liveId: string | null,
    livePartial: boolean,
  ): void {
    if (livePartial && this.run?.id === row.run_id) {
      run.bubbled = this.run.bubbled
      run.toolStarted = this.run.toolStarted
      run.tools = this.run.tools
      run.quiet = this.run.quiet
    }
    for (const entry of entries) {
      if (entry.kind === "pi.user" || entry.kind === "kiko.input")
        run.quiet = entry.id <= run.cursor ? quietInput(entry) : run.quiet && quietInput(entry)
      if (entry.id <= run.cursor) continue
      if (row.until !== undefined && entry.id > row.until) break
      if (row.until === undefined && row.run_id !== liveId && (entry.kind === "pi.user" || entry.kind === "kiko.input"))
        break
      this.finishGeneration(run, entry)
    }
    if (livePartial && this.run?.id === row.run_id) run.generation = this.run.generation
  }

  private nextQuiet = false

  private see(entry: EntryRecord | undefined): void {
    if ((entry?.kind === "pi.user" || entry?.kind === "kiko.input") && this.run)
      this.run.quiet = this.run.quiet && quietInput(entry)
    else if (entry?.kind === "pi.user" || entry?.kind === "kiko.input") this.nextQuiet = quietInput(entry)
  }

  async attach(
    harness: Harness,
    conversationId: Parameters<typeof watchEvents>[1],
    journal: JournalStorage,
  ): Promise<void> {
    this.journal = journal
    this.conversationId = conversationId
    const stream = await watchEvents(harness, conversationId, context)
    this.run = null
    this.state = "idle"
    await this.guard(() => this.sync(stream.snapshot, false))
    this.notifyIdle()
    stream.start(async (events) => {
      for (const event of events) {
        await this.guard(() => this.apply(event))
        this.notifyIdle()
      }
    })
    void stream.closed.then(() => {
      for (const waiter of this.idleWaiters)
        waiter.reject(new Error("Outbox closed before its final reply was delivered"))
      this.idleWaiters.clear()
    })
  }

  async settle(root: Conversation): Promise<void> {
    const view = await root.context(context)
    const entry = view.entries.reduce((last, row) => Math.max(last, row.id), 0)
    if (this.lastEntry >= entry && !this.run) return
    const done = Promise.withResolvers<void>()
    this.idleWaiters.add({ entry, resolve: () => done.resolve(), reject: done.reject })
    this.notifyIdle()
    await done.promise
  }

  private notifyIdle(): void {
    if (this.run) return
    for (const waiter of this.idleWaiters) {
      if (this.lastEntry < waiter.entry) continue
      this.idleWaiters.delete(waiter)
      waiter.resolve()
    }
  }

  async workers(rows: readonly WorkerRow[]): Promise<void> {
    await this.room()?.workers(rows)
  }

  async background(running: boolean, pending = false): Promise<void> {
    this.backgroundRunning = running
    if (!this.run && !(pending && !running)) await this.setStatus(running ? "working" : "idle")
  }

  clear(): void {
    this.run = null
  }

  runId(): string | null {
    return this.run?.id ?? null
  }

  async fail(requestId: string, error: unknown, provider = ""): Promise<void> {
    const id = this.run?.id ?? `${this.prefix()}:host:${requestId}`
    const message = error instanceof Error ? error.message : String(error)
    const detail = runErrorDetail(message)
    await this.room()?.runError(id, { kind: classifyRunError(message), provider, ...(detail ? { detail } : {}) })
    await this.end(id)
  }

  progress(): RunProgress | null {
    const run = this.run
    if (!run) return null
    return {
      bubblePosted: run.bubbled || run.posted > 0 || run.attempt > 0,
      toolStarted: run.toolStarted,
      tools: new Map(run.tools),
    }
  }

  private async guard(step: () => Promise<void>): Promise<void> {
    try {
      await step()
    } catch (error) {
      console.error(`outbox: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async apply(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "snapshot":
        return this.sync(event, true)
      case "run_start":
        return this.start(`${this.prefix()}:${event.inputs[0]}`, this.lastEntry)
      case "message_start": {
        const message = event.message as AssistantLike
        if (message.role !== "assistant" || message.stopReason === "aborted" || !this.run) return
        this.run.generation = newGeneration()
        await this.setStatus("typing")
        return this.stream(textOf(message, false))
      }
      case "message_update": {
        const generation = this.run?.generation
        if (!generation) return
        for (const change of event.changes) {
          if (change.type === "text_start")
            generation.texts.set(change.contentIndex, (change.block as { text?: string }).text ?? "")
          else if (change.type === "text_delta")
            generation.texts.set(change.contentIndex, (generation.texts.get(change.contentIndex) ?? "") + change.delta)
          else if (change.type === "block" && change.block.type === "text")
            generation.texts.set(change.contentIndex, change.block.text)
          else if (change.type === "message") {
            generation.texts.clear()
            change.message.content.forEach((part, i) => {
              if (part.type === "text") generation.texts.set(i, part.text)
            })
          }
        }
        const text = [...generation.texts.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, t]) => scrubToolMarkup(t, false))
          .filter(Boolean)
          .join("\n\n")
        return this.stream(text)
      }
      case "message_end":
        this.lastEntry = Math.max(this.lastEntry, event.entry.id)
        this.see(event.entry)
        return this.entry(event.entry)
      case "entry_appended":
        this.lastEntry = Math.max(this.lastEntry, event.entry.id)
        this.see(event.entry)
        return
      case "tool_execution_start":
        if (this.run) {
          this.run.toolStarted = true
          this.run.tools.set(event.toolCallId, event.toolName)
        }
        return this.setStatus("working")
      case "tool_execution_end":
        this.see(event.entry)
        this.run?.tools.delete(event.toolCallId)
        return this.setStatus("typing")
      case "auto_retry_start":
        if (this.run?.failure) {
          this.run.failure = null
        }
        return this.setStatus("typing", retrying(event.attempt))
      case "auto_retry_end":
        return this.setStatus("typing", null)
      case "run_end":
        return this.end(`${this.prefix()}:${event.inputs[0]}`, event.inputs)
      default:
        return
    }
  }

  private async sync(snapshot: SnapshotEvent, livePartial: boolean): Promise<void> {
    const entries = snapshot.entries
    this.lastEntry = entries.reduce((max, e) => Math.max(max, e.id), this.lastEntry)
    const liveId = snapshot.run ? `${this.prefix()}:${snapshot.run.inputs[0]}` : null
    for (const row of await this.openRows(snapshot)) {
      const run = this.load(row)
      this.replayEntries(run, row, entries, liveId, livePartial)
      this.run = run
      if (run.posted > run.blocks.length + (run.generation?.blocks.length ?? 0)) this.rebase(run)
      await this.notes(run)
      if (row.run_id !== liveId) await this.end(row.run_id)
    }
    if (liveId && this.run?.id !== liveId) {
      const last = entries.findLast((e) => e.kind === "pi.user" || e.kind === "kiko.input")
      const input = last?.id ?? 0
      await this.start(liveId, input)
      const run = this.run
      if (!run) throw new Error(`no run after starting ${liveId}`)
      run.quiet = last ? quietInput(last) : false
      for (const entry of entries) {
        if (entry.id > input) this.finishGeneration(run, entry)
      }
      await this.notes(run)
    }
    if (!this.run) return
    const answered = entries.findLastIndex((e) => {
      const m = assistant(e)
      return m !== undefined && !hasToolCall(m) && m.stopReason !== "aborted"
    })
    if (entries.slice(answered + 1).some((e) => hasToolCall(assistant(e)))) this.run.toolStarted = true
    await this.flush()
    await this.setStatus("typing")
    const partial = snapshot.generation?.message as AssistantLike | undefined
    if (livePartial && partial) {
      this.run.generation ??= newGeneration()
      await this.stream(textOf(partial, false))
    }
  }

  private async start(id: string, cursor: number): Promise<void> {
    const row = this.row(id, cursor)
    this.run = this.load(row)
    this.run.quiet = this.nextQuiet
    await this.setStatus("typing")
  }

  private async stream(text: string): Promise<void> {
    const run = this.run
    const generation = run?.generation
    if (!run || !generation || run.quiet) return
    if (!text.startsWith(generation.fed)) return
    const out = generation.splitter.push(text.slice(generation.fed.length))
    generation.fed = text
    generation.blocks.push(...out.blocks)
    this.queueReactions(run, out.reactions, run.generationIndex, generation.reactionIndex)
    generation.reactionIndex += out.reactions.length
    await this.flush()
    if (out.draft !== null && this.now() - this.lastDraft >= DRAFT_INTERVAL_MS) {
      this.lastDraft = this.now()
      await this.room()?.draft(run.id, run.blocks.length + generation.blocks.length, out.draft)
    }
  }

  private async entry(entry: EntryRecord): Promise<void> {
    const run = this.run
    if (!run) return
    const before = run.blocks.length
    const lost = this.finishGeneration(run, entry)
    if (lost && run.posted > before) this.rebase(run)
    await this.flush()
    await this.notes(run)
  }

  private async notes(run: Run): Promise<void> {
    const port = this.room()
    if (!run.notes.length || !port) return
    for (const note of run.notes.splice(0)) await port.note(run.id, note.id, note.text)
  }

  private async reportError(runId: string, message: Failure): Promise<void> {
    const detail = runErrorDetail(message.errorMessage)
    await this.room()
      ?.runError(runId, {
        kind: classifyRunError(message.errorMessage),
        provider: message.provider ?? "",
        ...(detail ? { detail } : {}),
      })
      .catch((e: unknown) => console.error(`run error not reported: ${e instanceof Error ? e.message : String(e)}`))
  }

  private finishGeneration(run: Run, entry: EntryRecord): boolean {
    run.cursor = Math.max(run.cursor, entry.id)
    const message = assistant(entry)
    if (!message) return false
    const generationIndex = run.generationIndex++
    run.failure =
      message.stopReason === "error"
        ? {
            ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
            ...(message.provider ? { provider: message.provider } : {}),
          }
        : null
    if (hasToolCall(message)) run.toolStarted = true
    const streamed = run.generation?.blocks ?? []
    run.generation = null
    if (message.stopReason === "aborted") return true
    if (message.stopReason === "error") return false
    const post = postOf(message, { posted: run.blocks.length > 0, quiet: run.quiet })
    const text = textOf(message)
    if (post === "none" && !run.quiet && hasToolCall(message) && text.trim())
      run.notes.push({ id: noteId(entry.id), text: noteOf(text) })
    const { blocks: final, reactions } = partsOf(post === "ack" ? ackOf(text) : post === "answer" ? text : "")
    run.blocks.push(...final)
    this.queueReactions(run, reactions, generationIndex)
    return streamed.some((block, i) => block !== final[i])
  }

  private queueReactions(run: Run, reactions: Reaction[], generation: number, start = 0): void {
    for (const [index, reaction] of reactions.entries())
      run.reactions.push({ ...reaction, deliveryId: `${run.id}:reaction:${generation}:${start + index}` })
  }

  private rebase(run: Run): void {
    run.attempt++
    run.posted = 0
  }

  private async flush(): Promise<void> {
    const run = this.run
    const room = this.room()
    if (!run || !room) return
    const all = [...run.blocks, ...(run.generation?.blocks ?? [])]
    while (run.posted < all.length) {
      run.bubbled = true
      const block = all[run.posted]
      if (block === undefined) break
      await room.post(run.id, run.attempt, run.posted, block)
      run.posted++
    }
    while (run.reactions.length) {
      const reaction = run.reactions[0]
      if (reaction === undefined) break
      const { emoji, messageId } = reaction
      await room.react(reaction.deliveryId, emoji, messageId)
      run.reactions.shift()
    }
  }

  private async end(id: string, inputs?: readonly SubmissionId[]): Promise<void> {
    const run = this.run?.id === id ? this.run : null
    if (run) {
      run.generation = null
      await this.flush()
    }
    const failure = run?.failure
    if (failure) await this.reportError(id, failure)
    const working = this.backgroundRunning
    await this.room()?.endRun(id, inputs, working)
    if (this.run?.id === id) this.run = null
    this.state = working ? "working" : "idle"
    if (!this.run) await this.setStatus(this.backgroundRunning ? "working" : "idle")
  }

  private async setStatus(state: AgentState, detail?: string | null): Promise<void> {
    const next = detail === undefined ? this.detail : (detail ?? undefined)
    if (state === this.state && next === this.detail) return
    this.state = state
    this.detail = next
    await this.room()?.status(state, detail)
  }

  private row(id: string, cursor: number): Row {
    const roomId = this.agent.split(":")[0]!
    const posted = this.sql
      .exec<{ attempt: number; posted: number }>(
        "SELECT run_attempt AS attempt, max(run_index) + 1 AS posted FROM messages WHERE room_id = ? AND run_id = ? GROUP BY run_attempt ORDER BY run_attempt DESC LIMIT 1",
        roomId,
        id,
      )
      .toArray()[0]
    return { run_id: id, cursor, posted: posted?.posted ?? 0, attempt: posted?.attempt ?? 0 }
  }

  private async openRows(snapshot: SnapshotEvent): Promise<Row[]> {
    if (!this.journal) return []
    const rows: Row[] = []
    const groups = new Map<number, { first: number; last: number; id: SubmissionId; answer?: number }>()
    let cursor: Parameters<Storage["scanSubmissions"]>[2]
    do {
      const page = await this.journal.scanSubmissions({ conversationId: this.conversationId }, 100, cursor, context)
      for (const submission of page.items) {
        if (submission.type !== "input" || submission.entry === undefined) continue
        if (snapshot.run?.inputs.includes(submission.id) && snapshot.run.inputs[0] !== submission.id) continue
        const settlement = this.journal.settlement(submission.id)
        const groupId = settlement ?? -submission.id
        const group = groups.get(groupId)
        if (group) {
          group.last = Math.max(group.last, submission.entry)
          continue
        }
        groups.set(groupId, {
          first: submission.entry,
          last: submission.entry,
          id: submission.id,
          ...(submission.status === "done" ? { answer: submission.answer } : {}),
        })
      }
      cursor = page.next
    } while (cursor)
    const ordered = [...groups.values()].sort((a, b) => a.first - b.first)
    for (const [index, group] of ordered.entries()) {
      const id = `${this.prefix()}:${group.id}`
      const next = ordered[index + 1]?.first
      const until =
        group.answer ?? (snapshot.run?.inputs[0] === group.id ? undefined : next === undefined ? Infinity : next - 1)
      rows.push({ ...this.row(id, group.first), ...(until === undefined ? {} : { until }) })
    }
    return rows
  }

  private load(row: Row): Run {
    return {
      id: row.run_id,
      attempt: row.attempt,
      cursor: row.cursor,
      blocks: [],
      posted: row.posted,
      reactions: [],
      generationIndex: 0,
      generation: null,
      bubbled: false,
      toolStarted: false,
      tools: new Map(),
      quiet: false,
      notes: [],
      failure: null,
    }
  }
}
