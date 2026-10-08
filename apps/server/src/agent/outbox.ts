import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { type AgentEvent, type EntryRecord, type Harness, type SnapshotEvent, type SubmissionId, watchEvents } from "@earendil-works/pi-durable"
import type { AgentState } from "@kiko/protocol"
import type { Message } from "@earendil-works/pi-ai"
import { taints } from "@kiko/agent/trust"
import type { RunProgress } from "@kiko/agent/mid-run"
import { createSplitter, type Reaction, type Splitter } from "./split-bubbles"

const context = BACKGROUND_CONTEXT
export const DRAFT_INTERVAL_MS = 300

export interface RoomPort {
  post(runId: string, attempt: number, index: number, block: string, tainted: boolean): Promise<unknown>
  draft(runId: string, index: number, text: string): Promise<void>
  status(state: AgentState): Promise<void>
  endRun(runId: string, inputs?: readonly SubmissionId[]): Promise<void>
  react(emoji: string, messageId?: string): Promise<unknown>
}

type Row = { run_id: string; attempt: number; cursor: number; blocks: string; posted: number; tainted: number }

type AssistantLike = { role?: string; stopReason?: string; content?: readonly { type: string; text?: string }[] }

function textOf(message: AssistantLike | undefined): string {
  return (message?.content ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n\n")
}

export function partsOf(text: string): { blocks: string[]; reactions: Reaction[] } {
  const splitter = createSplitter()
  const head = splitter.push(text)
  const tail = splitter.end()
  return { blocks: [...head.blocks, ...tail.blocks], reactions: [...head.reactions, ...tail.reactions] }
}

export const blocksOf = (text: string): string[] => partsOf(text).blocks

const assistant = (entry: EntryRecord): AssistantLike | undefined => {
  const message = entry.model?.[0] as AssistantLike | undefined
  return message?.role === "assistant" ? message : undefined
}

type Generation = { texts: Map<number, string>; fed: string; splitter: Splitter; blocks: string[] }

const newGeneration = (): Generation => ({ texts: new Map(), fed: "", splitter: createSplitter(), blocks: [] })

type Run = {
  id: string
  attempt: number
  cursor: number
  blocks: string[]
  posted: number
  tainted: boolean
  reactions: Reaction[]
  generation: Generation | null
  bubbled: boolean
  toolStarted: boolean
  toolsRunning: number
}

const hasToolCall = (message: AssistantLike | undefined) => (message?.content ?? []).some((part) => part.type === "toolCall")

export class Outbox {
  private readonly sql: SqlStorage
  private run: Run | null = null
  private lastEntry = 0
  private lastDraft = 0
  private state: AgentState = "idle"

  constructor(
    storage: DurableObjectStorage,
    private readonly room: () => RoomPort | null,
    private readonly prefix: () => string,
    private readonly now: () => number = Date.now,
  ) {
    this.sql = storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS outbox (
      run_id TEXT PRIMARY KEY,
      attempt INTEGER NOT NULL,
      cursor INTEGER NOT NULL,
      blocks TEXT NOT NULL,
      posted INTEGER NOT NULL,
      ended INTEGER NOT NULL DEFAULT 0
    ) STRICT`)
    if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('outbox')").toArray().some((c) => c.name === "tainted")) {
      this.sql.exec("ALTER TABLE outbox ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0")
    }
  }

  private taintPending = false

  private see(entry: EntryRecord | undefined): void {
    const message = entry?.model?.[0] as Message | undefined
    if (!message || !taints(message)) return
    if (this.run) this.run.tainted = true
    else this.taintPending = true
  }

  async attach(harness: Harness, conversationId: Parameters<typeof watchEvents>[1]): Promise<void> {
    const stream = await watchEvents(harness, conversationId, context)
    this.run = null
    this.state = "idle"
    await this.guard(() => this.sync(stream.snapshot, false))
    stream.start(async (events) => {
      for (const event of events) await this.guard(() => this.apply(event))
    })
  }

  clear(): void {
    this.sql.exec("DELETE FROM outbox")
  }

  progress(): RunProgress | null {
    const run = this.run
    if (!run) return null
    return { bubblePosted: run.bubbled || run.posted > 0 || run.attempt > 0, toolStarted: run.toolStarted, toolRunning: run.toolsRunning > 0 }
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
        return this.stream(textOf(message))
      }
      case "message_update": {
        const generation = this.run?.generation
        if (!generation) return
        for (const change of event.changes) {
          if (change.type === "text_start") generation.texts.set(change.contentIndex, (change.block as { text?: string }).text ?? "")
          else if (change.type === "text_delta") generation.texts.set(change.contentIndex, (generation.texts.get(change.contentIndex) ?? "") + change.delta)
          else if (change.type === "block" && change.block.type === "text") generation.texts.set(change.contentIndex, change.block.text)
          else if (change.type === "message") {
            generation.texts.clear()
            change.message.content.forEach((part, i) => part.type === "text" && generation.texts.set(i, part.text))
          }
        }
        const text = [...generation.texts.entries()].sort(([a], [b]) => a - b).map(([, t]) => t).filter(Boolean).join("\n\n")
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
          this.run.toolsRunning++
        }
        return this.setStatus("working")
      case "tool_execution_end":
        this.see(event.entry)
        if (this.run) this.run.toolsRunning = Math.max(0, this.run.toolsRunning - 1)
        return this.setStatus("typing")
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
    for (const row of this.openRows()) {
      const run = this.load(row)
      if (livePartial && this.run?.id === row.run_id) {
        run.generation = this.run.generation
        run.bubbled = this.run.bubbled
        run.toolStarted = this.run.toolStarted
        run.toolsRunning = this.run.toolsRunning
      }
      for (const entry of entries) {
        if (entry.id <= run.cursor) continue
        if (row.run_id !== liveId && entry.kind === "pi.user") break
        if (entry.model?.[0] && taints(entry.model[0])) run.tainted = true
        this.finishGeneration(run, entry)
      }
      this.run = run
      if (run.posted > run.blocks.length + (run.generation?.blocks.length ?? 0)) this.rebase(run)
      this.save(run)
      if (row.run_id !== liveId) await this.end(row.run_id)
    }
    if (liveId && this.run?.id !== liveId) {
      const input = entries.findLast((e) => e.kind === "pi.user")?.id ?? 0
      await this.start(liveId, input)
      const run = this.run!
      for (const entry of entries) {
        if (entry.id >= input && entry.model?.[0] && taints(entry.model[0])) run.tainted = true
        if (entry.id > input) this.finishGeneration(run, entry)
      }
      this.save(run)
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
      await this.stream(textOf(partial))
    }
  }

  private async start(id: string, cursor: number): Promise<void> {
    this.sql.exec("INSERT OR IGNORE INTO outbox (run_id, attempt, cursor, blocks, posted) VALUES (?, 0, ?, '[]', 0)", id, cursor)
    const row = this.sql.exec<Row>("SELECT * FROM outbox WHERE run_id = ?", id).one()
    this.run = this.load(row)
    if (this.taintPending) this.run.tainted = true
    this.taintPending = false
    await this.setStatus("typing")
  }

  private async stream(text: string): Promise<void> {
    const run = this.run
    const generation = run?.generation
    if (!run || !generation) return
    if (!text.startsWith(generation.fed)) return
    const out = generation.splitter.push(text.slice(generation.fed.length))
    generation.fed = text
    generation.blocks.push(...out.blocks)
    run.reactions.push(...out.reactions)
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
    this.save(run)
    await this.flush()
  }

  private finishGeneration(run: Run, entry: EntryRecord): boolean {
    run.cursor = Math.max(run.cursor, entry.id)
    const message = assistant(entry)
    if (!message) return false
    if (hasToolCall(message)) run.toolStarted = true
    const streamed = run.generation?.blocks ?? []
    run.generation = null
    if (message.stopReason === "aborted") return true
    const { blocks: final, reactions } = partsOf(textOf(message))
    run.blocks.push(...final)
    run.reactions.push(...reactions)
    return streamed.some((block, i) => block !== final[i])
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
      await room.post(run.id, run.attempt, run.posted, all[run.posted]!, run.tainted)
      run.posted++
      this.sql.exec("UPDATE outbox SET posted = ?, attempt = ? WHERE run_id = ?", run.posted, run.attempt, run.id)
    }
    while (run.reactions.length) {
      const { emoji, messageId } = run.reactions[0]!
      await room.react(emoji, messageId)
      run.reactions.shift()
    }
  }

  private async end(id: string, inputs?: readonly SubmissionId[]): Promise<void> {
    const run = this.run?.id === id ? this.run : null
    if (run) {
      run.generation = null
      this.save(run)
      await this.flush()
    }
    await this.room()?.endRun(id, inputs)
    this.sql.exec("UPDATE outbox SET ended = 1 WHERE run_id = ?", id)
    if (this.run?.id === id) this.run = null
    this.taintPending = false
    this.state = "idle"
  }

  private async setStatus(state: AgentState): Promise<void> {
    if (state === this.state) return
    this.state = state
    await this.room()?.status(state)
  }

  private openRows(): Row[] {
    return this.sql.exec<Row>("SELECT run_id, attempt, cursor, blocks, posted, tainted FROM outbox WHERE ended = 0 ORDER BY rowid").toArray()
  }

  private load(row: Row): Run {
    return {
      id: row.run_id,
      attempt: row.attempt,
      cursor: row.cursor,
      blocks: JSON.parse(row.blocks) as string[],
      posted: row.posted,
      tainted: row.tainted === 1,
      reactions: [],
      generation: null,
      bubbled: false,
      toolStarted: false,
      toolsRunning: 0,
    }
  }

  private save(run: Run): void {
    this.sql.exec(
      "UPDATE outbox SET attempt = ?, cursor = ?, blocks = ?, posted = ?, tainted = ? WHERE run_id = ?",
      run.attempt,
      run.cursor,
      JSON.stringify(run.blocks),
      run.posted,
      run.tainted ? 1 : 0,
      run.id,
    )
  }
}
