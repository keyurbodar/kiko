import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { type AgentEvent, type EntryRecord, type Harness, type SnapshotEvent, watchEvents } from "@earendil-works/pi-durable"
import type { AgentState } from "@kiko/protocol"
import type { RunState } from "./mid-run"
import { createSplitter, type Splitter } from "./split-bubbles"

// Architecture section 6.3. The outbox watches the root conversation and turns the assistant's
// text into bubbles. A block is posted to the room as soon as the splitter closes it, a long open
// block goes out as a draft at most every 300 ms, and the status follows the run.
//
// Restarts. The blocks of every finished generation of a run are stored here, with the count the
// room has acknowledged. The blocks of the generation in flight live only in memory. When that
// generation is lost (a crash, a closed harness, a provider retry) after some of its blocks were
// posted, the model may write different text, so the attempt number goes up and every stored
// block is posted again under the new attempt. The room then deletes the earlier attempt's
// bubbles. A block is idempotent on `(runId, attempt, index)`, so a repeated post stores nothing.

const context = BACKGROUND_CONTEXT
export const DRAFT_INTERVAL_MS = 300

/** What the agent can do in its room. `AgentDO` binds it to the room's RPC and the agent's slug. */
export interface RoomPort {
  post(runId: string, attempt: number, index: number, block: string): Promise<unknown>
  draft(runId: string, index: number, text: string): Promise<void>
  status(state: AgentState): Promise<void>
  endRun(runId: string): Promise<void>
}

type Row = { run_id: string; attempt: number; cursor: number; blocks: string; posted: number }

type AssistantLike = { role?: string; stopReason?: string; content?: readonly { type: string; text?: string }[] }

/** The text blocks of an assistant message, joined. A tool call between two texts separates them. */
function textOf(message: AssistantLike | undefined): string {
  return (message?.content ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n\n")
}

/** Every block the splitter closes for a whole text. Pure, so a partial's blocks are a prefix of the final's. */
export function blocksOf(text: string): string[] {
  const splitter = createSplitter()
  return [...splitter.push(text).blocks, ...splitter.end().blocks]
}

const assistant = (entry: EntryRecord): AssistantLike | undefined => {
  const message = entry.model?.[0] as AssistantLike | undefined
  return message?.role === "assistant" ? message : undefined
}

/** The generation in flight, in memory only. */
type Generation = { texts: Map<number, string>; fed: string; splitter: Splitter; blocks: string[] }

const newGeneration = (): Generation => ({ texts: new Map(), fed: "", splitter: createSplitter(), blocks: [] })

/**
 * The run this process is following. `blocks` holds the finished generations' blocks, as stored.
 * `bubbled`, `toolStarted`, and `toolsRunning` are what the mid-run rules read (section 6.2).
 */
type Run = {
  id: string
  attempt: number
  cursor: number
  blocks: string[]
  posted: number
  generation: Generation | null
  bubbled: boolean
  toolStarted: boolean
  toolsRunning: number
}

/** What the mid-run rules need to know of the run in flight. */
export type RunProgress = Pick<RunState, "bubblePosted" | "toolStarted" | "toolRunning">

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
    /** Prefixes the run id, so two agents in one room never share one. */
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
  }

  /**
   * Starts watching. Called once per opened harness, before it resumes, so nothing runs yet and a
   * partial in the snapshot is a leftover the next request discards.
   */
  async attach(harness: Harness, conversationId: Parameters<typeof watchEvents>[1]): Promise<void> {
    const stream = await watchEvents(harness, conversationId, context)
    this.run = null
    this.state = "idle"
    await this.guard(() => this.sync(stream.snapshot, false))
    stream.start(async (events) => {
      for (const event of events) await this.guard(() => this.apply(event))
    })
  }

  /**
   * The run this process follows, or null when it has seen none start. A bubble counts as posted
   * from the moment its post is sent, and a tool from the moment the model asked for it.
   */
  progress(): RunProgress | null {
    const run = this.run
    if (!run) return null
    return { bubblePosted: run.bubbled || run.posted > 0 || run.attempt > 0, toolStarted: run.toolStarted, toolRunning: run.toolsRunning > 0 }
  }

  /** A room call failed. The run state stays, and the next event or the next attach posts what is left. */
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
        // The watch fell behind. The snapshot's partial is live this time.
        return this.sync(event, true)
      case "run_start":
        return this.start(`${this.prefix()}:${event.inputs[0]}`, this.lastEntry)
      case "message_start": {
        const message = event.message as AssistantLike
        // An aborted entry is a lost partial, never text to post.
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
        return this.entry(event.entry)
      case "entry_appended":
        this.lastEntry = Math.max(this.lastEntry, event.entry.id)
        return
      case "tool_execution_start":
        if (this.run) {
          this.run.toolStarted = true
          this.run.toolsRunning++
        }
        return this.setStatus("working")
      case "tool_execution_end":
        if (this.run) this.run.toolsRunning = Math.max(0, this.run.toolsRunning - 1)
        return this.setStatus("typing")
      case "run_end":
        return this.end(`${this.prefix()}:${event.inputs[0]}`)
      default:
        return
    }
  }

  /** Brings the run up to the snapshot: finished generations from entries, then the live partial if asked. */
  private async sync(snapshot: SnapshotEvent, livePartial: boolean): Promise<void> {
    const entries = snapshot.entries
    this.lastEntry = entries.reduce((max, e) => Math.max(max, e.id), this.lastEntry)
    const liveId = snapshot.run ? `${this.prefix()}:${snapshot.run.inputs[0]}` : null
    for (const row of this.openRows()) {
      const run = this.load(row)
      // After an overflow the generation in flight is still live and keeps its blocks.
      if (livePartial && this.run?.id === row.run_id) {
        run.generation = this.run.generation
        run.bubbled = this.run.bubbled
        run.toolStarted = this.run.toolStarted
        run.toolsRunning = this.run.toolsRunning
      }
      // Entries after the cursor that this process never saw. A finished run's entries stop at the next input.
      for (const entry of entries) {
        if (entry.id <= run.cursor) continue
        if (row.run_id !== liveId && entry.kind === "pi.user") break
        this.finishGeneration(run, entry)
      }
      this.run = run
      if (run.posted > run.blocks.length + (run.generation?.blocks.length ?? 0)) this.rebase(run)
      this.save(run)
      if (row.run_id !== liveId) await this.end(row.run_id)
    }
    if (liveId && this.run?.id !== liveId) {
      // The run started before this process saw it. Its input is the newest user entry.
      const input = entries.findLast((e) => e.kind === "pi.user")?.id ?? 0
      await this.start(liveId, input)
      const run = this.run!
      for (const entry of entries) if (entry.id > input) this.finishGeneration(run, entry)
      this.save(run)
    }
    if (!this.run) return
    // The run in flight is everything after the last finished answer. A process that reopened learns
    // here that a tool round started before it. ASSUMPTION: a reopened process cannot tell whether a
    // tool still runs, and "started" is enough to rule out a restart.
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
    await this.setStatus("typing")
  }

  /** Feeds the generation's text so far. Only an append reaches the splitter. */
  private async stream(text: string): Promise<void> {
    const run = this.run
    const generation = run?.generation
    if (!run || !generation) return
    // A replaced block is settled when its entry lands. Until then nothing more is posted from it.
    if (!text.startsWith(generation.fed)) return
    const out = generation.splitter.push(text.slice(generation.fed.length))
    generation.fed = text
    generation.blocks.push(...out.blocks)
    // ASSUMPTION: reaction tags are dropped until reactions land (P6-08).
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

  /**
   * Applies one entry to the run. A finished answer adds its blocks. An aborted one is the lost
   * partial of an interrupted generation and adds nothing. Returns true when the generation was lost
   * or its final blocks differ from what was posted from its partial.
   */
  private finishGeneration(run: Run, entry: EntryRecord): boolean {
    run.cursor = Math.max(run.cursor, entry.id)
    const message = assistant(entry)
    if (!message) return false
    // A tool-calling answer starts its tool round in the same commit. A reopened process learns it here.
    if (hasToolCall(message)) run.toolStarted = true
    const streamed = run.generation?.blocks ?? []
    run.generation = null
    if (message.stopReason === "aborted") return true
    const final = blocksOf(textOf(message))
    run.blocks.push(...final)
    return streamed.some((block, i) => block !== final[i])
  }

  /** The posted blocks are no longer the run's text. Post every stored block again under a new attempt. */
  private rebase(run: Run): void {
    run.attempt++
    run.posted = 0
  }

  /** Posts every block the room has not acknowledged, in order. Stops at the first failure. */
  private async flush(): Promise<void> {
    const run = this.run
    const room = this.room()
    if (!run || !room) return
    const all = [...run.blocks, ...(run.generation?.blocks ?? [])]
    while (run.posted < all.length) {
      run.bubbled = true
      await room.post(run.id, run.attempt, run.posted, all[run.posted]!)
      run.posted++
      this.sql.exec("UPDATE outbox SET posted = ?, attempt = ? WHERE run_id = ?", run.posted, run.attempt, run.id)
    }
  }

  /** The run answered or failed. Posts what is left, then tells the room once. */
  private async end(id: string): Promise<void> {
    const run = this.run?.id === id ? this.run : null
    if (run) {
      run.generation = null
      this.save(run)
      await this.flush()
    }
    await this.room()?.endRun(id)
    this.sql.exec("UPDATE outbox SET ended = 1 WHERE run_id = ?", id)
    if (this.run?.id === id) this.run = null
    this.state = "idle"
  }

  private async setStatus(state: AgentState): Promise<void> {
    if (state === this.state) return
    this.state = state
    await this.room()?.status(state)
  }

  private openRows(): Row[] {
    return this.sql.exec<Row>("SELECT run_id, attempt, cursor, blocks, posted FROM outbox WHERE ended = 0 ORDER BY rowid").toArray()
  }

  private load(row: Row): Run {
    return {
      id: row.run_id,
      attempt: row.attempt,
      cursor: row.cursor,
      blocks: JSON.parse(row.blocks) as string[],
      posted: row.posted,
      generation: null,
      bubbled: false,
      toolStarted: false,
      toolsRunning: 0,
    }
  }

  private save(run: Run): void {
    this.sql.exec(
      "UPDATE outbox SET attempt = ?, cursor = ?, blocks = ?, posted = ? WHERE run_id = ?",
      run.attempt,
      run.cursor,
      JSON.stringify(run.blocks),
      run.posted,
      run.id,
    )
  }
}
