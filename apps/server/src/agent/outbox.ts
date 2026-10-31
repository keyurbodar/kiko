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
import { classifyRunError, runErrorDetail } from "./run-error"
import { retrying } from "./retry"
import { type Assistant, ackOf, hasToolCall, noteOf, postOf } from "./pacing"
import { scrubToolMarkup } from "./tool-markup"
import { createSplitter, type Reaction, type Splitter } from "./split-bubbles"

const context = BACKGROUND_CONTEXT
const THINKING_INTERVAL_MS = 500
const THINKING_CHARS = 1_500

export interface RoomPort {
  post(runId: string, attempt: number, index: number, block: string): Promise<unknown>
  thinking(runId: string, part: number, offset: number, text: string, startedAt: number, done: boolean): Promise<void>
  note(runId: string, id: string, text: string): Promise<void>
  status(state: AgentState, detail?: string | null): Promise<void>
  workers(rows: readonly WorkerRow[]): Promise<void>
  endRun(runId: string, inputs?: readonly SubmissionId[], working?: boolean): Promise<void>
  react(deliveryId: string, emoji: string, messageId?: string): Promise<unknown>
  runError(runId: string, error: { kind: RunErrorKind; provider: string; detail?: string }): Promise<void>
}

type Row = { run_id: string; attempt: number; cursor: number; posted: number; until?: number }

type Posted = { attempt: number; posted: number }

type Group = { first: number; id: SubmissionId; settled: boolean; answer?: number }

type Failure = { errorMessage?: string; provider?: string }

type AssistantLike = Assistant

function textOf(message: AssistantLike | undefined, final = true): string {
  return (message?.content ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [scrubToolMarkup(part.text, final)] : []))
    .join("\n\n")
}

type Change = Extract<AgentEvent, { type: "message_update" }>["changes"][number]

const startsAnswer = (change: Change) => change.type === "text_start" || change.type === "toolcall_start"

function hearThought(generation: Generation, change: Change): void {
  if (change.type === "thinking_start" && change.block.type === "thinking")
    generation.thoughts.set(change.contentIndex, change.block.thinking)
  else if (change.type === "thinking_delta")
    generation.thoughts.set(change.contentIndex, (generation.thoughts.get(change.contentIndex) ?? "") + change.delta)
  else if (change.type === "block" && change.block.type === "thinking")
    generation.thoughts.set(change.contentIndex, change.block.thinking)
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
  thoughts: Map<number, string>
  thought: "none" | "open" | "done"
  thoughtStartedAt: number
  thoughtSent: number
  fed: string
  splitter: Splitter
  blocks: string[]
}

const newGeneration = (startedAt: number): Generation => ({
  reactionIndex: 0,
  texts: new Map(),
  thoughts: new Map(),
  thought: "none",
  thoughtStartedAt: startedAt,
  thoughtSent: 0,
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
  private lastThought = 0
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
    if (livePartial && this.run?.id === row.run_id) run.quiet = this.run.quiet
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
    if (this.run) return this.wait(this.lastEntry)
    const newest = (await root.entries({}, 1, undefined, context)).items[0]?.id ?? 0
    if (this.lastEntry >= newest) return
    return this.wait(newest)
  }

  private async wait(entry: number): Promise<void> {
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
        this.run.generation = newGeneration(this.now())
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
              if (part.type === "thinking") generation.thoughts.set(i, part.thinking)
            })
          } else hearThought(generation, change)
        }
        await this.think(generation, event.changes.some(startsAnswer))
        const text = [...generation.texts.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, t]) => scrubToolMarkup(t, false))
          .filter(Boolean)
          .join("\n\n")
        return this.stream(text)
      }
      case "message_end":
        if (this.run?.generation) await this.thinkLast(this.run.generation, event.entry)
        this.lastEntry = Math.max(this.lastEntry, event.entry.id)
        this.see(event.entry)
        return this.entry(event.entry)
      case "entry_appended":
        this.lastEntry = Math.max(this.lastEntry, event.entry.id)
        this.see(event.entry)
        return
      case "tool_execution_start":
        return this.setStatus("working")
      case "tool_execution_end":
        this.see(event.entry)
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
    const { rows, newestFinished } = await this.openRows(snapshot)
    for (const row of rows) {
      const run = this.load(row)
      this.replayEntries(run, row, entries, liveId, livePartial)
      this.run = run
      if (run.posted > run.blocks.length + (run.generation?.blocks.length ?? 0)) this.rebase(run)
      if (row.run_id !== liveId && row.run_id !== newestFinished && !this.unposted(run)) {
        this.run = null
        continue
      }
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
    await this.flush()
    await this.setStatus("typing")
    const partial = snapshot.generation?.message as AssistantLike | undefined
    if (livePartial && partial) {
      this.run.generation ??= newGeneration(this.now())
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
  }

  private async thinkLast(generation: Generation, entry: EntryRecord): Promise<void> {
    for (const [i, part] of (assistant(entry)?.content ?? []).entries())
      if (part.type === "thinking" && "thinking" in part && typeof part.thinking === "string")
        generation.thoughts.set(i, part.thinking)
    await this.think(generation, true)
  }

  private async think(generation: Generation, answered: boolean): Promise<void> {
    const run = this.run
    if (!run || run.quiet || generation.thought === "done" || generation.thoughts.size === 0) return
    const done = answered || generation.texts.size > 0
    if (!done && generation.thought === "open" && this.now() - this.lastThought < THINKING_INTERVAL_MS) return
    generation.thought = done ? "done" : "open"
    this.lastThought = this.now()
    const full = [...generation.thoughts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, t]) => t.trim())
      .filter(Boolean)
      .join("\n\n")
    const part = run.generationIndex
    const offset = done ? 0 : generation.thoughtSent
    const text = done ? full : full.slice(offset, offset + THINKING_CHARS)
    if (!done && text.length === 0) return
    generation.thoughtSent = done ? full.length : offset + text.length
    await this.room()?.thinking(run.id, part, offset, text, generation.thoughtStartedAt, done)
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

  private unposted(run: Run): boolean {
    return run.posted < run.blocks.length + (run.generation?.blocks.length ?? 0)
  }

  private async flush(): Promise<void> {
    const run = this.run
    const room = this.room()
    if (!run || !room) return
    const all = [...run.blocks, ...(run.generation?.blocks ?? [])]
    while (run.posted < all.length) {
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
    try {
      if (run) {
        run.generation = null
        await this.flush().catch((error: unknown) =>
          this.reportError(id, { errorMessage: error instanceof Error ? error.message : String(error) }),
        )
      }
      const failure = run?.failure ?? (await this.unanswered(inputs?.[0]))
      if (failure) await this.reportError(id, failure)
      const working = this.backgroundRunning
      await this.room()?.endRun(id, inputs, working)
      this.state = working ? "working" : "idle"
    } finally {
      if (this.run?.id === id) this.run = null
      if (!this.run) {
        for (const waiter of this.idleWaiters) {
          this.idleWaiters.delete(waiter)
          waiter.resolve()
        }
        await this.setStatus(this.backgroundRunning ? "working" : "idle").catch(() => {})
      }
    }
  }

  private async unanswered(input: SubmissionId | undefined): Promise<Failure | null> {
    const record = input === undefined ? undefined : await this.journal?.submission(input, context)
    if (record?.status !== "unanswered") return null
    if (record.reason === "no_model") return { errorMessage: "model is not available" }
    if (record.reason !== "model_error" && record.reason !== "faulted") return null
    return { errorMessage: typeof record.detail === "string" ? record.detail : record.reason }
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
      .exec<Posted>(
        "SELECT run_attempt AS attempt, max(run_index) + 1 AS posted FROM messages WHERE room_id = ? AND run_id = ? GROUP BY run_attempt ORDER BY run_attempt DESC LIMIT 1",
        roomId,
        id,
      )
      .toArray()[0]
    return { run_id: id, cursor, posted: posted?.posted ?? 0, attempt: posted?.attempt ?? 0 }
  }

  private postedRows(): Map<string, Posted> {
    const roomId = this.agent.split(":")[0]!
    const rows = new Map<string, Posted>()
    for (const row of this.sql
      .exec<Posted & { run_id: string }>(
        "SELECT run_id, run_attempt AS attempt, max(run_index) + 1 AS posted FROM messages WHERE room_id = ? AND run_id IS NOT NULL GROUP BY run_id, run_attempt",
        roomId,
      )
      .toArray())
      if ((rows.get(row.run_id)?.attempt ?? -1) < row.attempt)
        rows.set(row.run_id, { attempt: row.attempt, posted: row.posted })
    return rows
  }

  private async submissionGroups(journal: JournalStorage, snapshot: SnapshotEvent): Promise<Group[]> {
    const groups = new Map<number, Group>()
    let cursor: Parameters<Storage["scanSubmissions"]>[2]
    do {
      const page = await journal.scanSubmissions({ conversationId: this.conversationId }, 100, cursor, context)
      for (const submission of page.items) {
        if (submission.type !== "input" || submission.entry === undefined) continue
        if (snapshot.run?.inputs.includes(submission.id) && snapshot.run.inputs[0] !== submission.id) continue
        const settlement = journal.settlement(submission.id)
        const groupId = settlement ?? -submission.id
        const group = groups.get(groupId)
        if (group) {
          group.settled ||= settlement !== undefined
          continue
        }
        groups.set(groupId, {
          first: submission.entry,
          id: submission.id,
          settled: settlement !== undefined,
          ...(submission.status === "done" ? { answer: submission.answer } : {}),
        })
      }
      cursor = page.next
    } while (cursor)
    return [...groups.values()].sort((a, b) => a.first - b.first)
  }

  private async openRows(snapshot: SnapshotEvent): Promise<{ rows: Row[]; newestFinished?: string }> {
    if (!this.journal) return { rows: [] }
    const rows: Row[] = []
    const ordered = await this.submissionGroups(this.journal, snapshot)
    const newestFinished = ordered.findLast((group) => group.settled)
    const posted = this.postedRows()
    for (const [index, group] of ordered.entries()) {
      if (group.settled && group !== newestFinished) continue
      const id = `${this.prefix()}:${group.id}`
      const next = ordered[index + 1]?.first
      const until =
        group.answer ?? (snapshot.run?.inputs[0] === group.id ? undefined : next === undefined ? Infinity : next - 1)
      const counts = posted.get(id)
      rows.push({
        run_id: id,
        cursor: group.first,
        posted: counts?.posted ?? 0,
        attempt: counts?.attempt ?? 0,
        ...(until === undefined ? {} : { until }),
      })
    }
    return {
      rows,
      ...(newestFinished === undefined ? {} : { newestFinished: `${this.prefix()}:${newestFinished.id}` }),
    }
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
      quiet: false,
      notes: [],
      failure: null,
    }
  }
}
