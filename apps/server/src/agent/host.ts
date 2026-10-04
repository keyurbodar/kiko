import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Models } from "@earendil-works/pi-ai"
import { type AgentChange, type Conversation, Harness, type HarnessSettings, type RegistryReader } from "@earendil-works/pi-durable"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import type { Envelope } from "@kiko/protocol"
import { type Alarms, createAlarms } from "../lib/alarm"
import { type CoalescingStorage, createCoalescingStorage } from "./coalescing-storage"
import { type Batch, Inbox, type Refusal, renderInput } from "./inbox"
import { type Arrival, decide, FRESH_RUN, type RunState } from "./mid-run"
import type { RunProgress } from "./outbox"
import { openDurableObjectSqlite } from "./sqlite"

// Architecture sections 4.4 and 7.3. The host owns one agent's `pi-durable` harness inside its
// `AgentDO`. `receive()` only stores. The alarm does the work: it opens the harness, resumes what a
// dead process left unfinished, submits the inbox, and keeps a heartbeat while a task is live. The
// heartbeat never waits for a run and never resumes a run this process is already running.

const context = BACKGROUND_CONTEXT

/** Wakeup keys in `lib/alarm.ts`. */
export const INBOX_WAKEUP = "inbox"
export const HEARTBEAT_WAKEUP = "heartbeat"
/** Architecture section 4.4: at most 30 seconds ahead. */
export const HEARTBEAT_MS = 30_000
/** The first retry after a failed alarm. It doubles up to the heartbeat. */
const RETRY_MS = 1_000
/**
 * Section 13, after OptMem: an agent wakes from memory once, then works in an ordinary transcript, which
 * the provider caches because it only grows. When the transcript passes this many characters (about
 * 15,000 tokens), the next run starts over from the <memory> block: the log is the memory, so nothing
 * is lost, and no request grows without bound.
 */
export const CONTEXT_BUDGET_CHARS = 60_000
/**
 * A fresh start leaves old pi-durable entries in storage that are never read again. Every this many runs,
 * an idle agent drops pi-durable's tables, so storage stays bounded; its next run starts fresh.
 */
export const COMPACT_EVERY_RUNS = 50
const RUNS_KEY = "runs:since-compact"
/** Storage keys of the mid-run rules (section 6.2). */
const STOP_KEY = "mid-run:stop"
const RESTARTS_KEY = "mid-run:restarts"

/** What the agent factory (P1-10) decides. The host calls it once per process, when it opens the harness. */
export type AgentSetup = {
  models: Models
  registry: RegistryReader
  /** Applied when the root conversation is created. */
  agent: AgentChange
  settings?: HarnessSettings
  /** The file system `pi-durable`'s file tools run on: the room's files. */
  env?: ExecutionEnv
  /**
   * Called once before a batch starts a new run (architecture section 11.3), never for a batch that
   * joins a live run. It loads the run's credentials. False means the run may not start: the batch is
   * dropped and nothing is submitted. Absent means every run may start.
   */
  beginRun?: (batch: Batch, root: Conversation) => Promise<boolean>
  /** One more `<context>` block for each submitted input, after the briefs: the clock and run notes. */
  inputContext?: () => Promise<string | undefined>
  /**
   * Section 13. Called when a batch starts a run, never for one that joins a live run. With `fresh`, or
   * when it decides the agent missed too much, it returns the whole <memory> block and `fresh: true`,
   * and the host starts the context over. Otherwise it returns only what is new in the chat since the
   * agent's last run, and the transcript goes on.
   */
  inputMemory?: (batch: Batch, fresh: boolean) => Promise<{ text?: string; fresh: boolean }>
  /** pi-durable's tables are about to be dropped: the agent keeps what it needs from them (its token count). */
  beforeCompact?: (harness: Harness) => Promise<void>
}

export type HostOptions = {
  setup: () => AgentSetup | Promise<AgentSetup>
  /** Runs once per process after the harness opens and before it resumes, so a watcher sees the resumed run. */
  onOpen?: (opened: Opened) => void | Promise<void>
  /** The breaker dropped a run that kept killing its process. The agent tells the room. */
  onGiveUp?: () => void | Promise<void>
  /** Default `HEARTBEAT_MS`. Tests pass less. Never more than `HEARTBEAT_MS`. */
  heartbeatMs?: number
  /** What the run in flight has shown so far: bubbles and tools. The outbox knows. Null before it saw the run start. */
  progress?: () => RunProgress | null
  /** The harness went idle: no task and no submission. The agent frees what only a run needs. */
  onIdle?: () => void
}

export type Opened = {
  harness: Harness
  root: Conversation
  storage: CoalescingStorage
  beginRun?: AgentSetup["beginRun"]
  inputContext?: AgentSetup["inputContext"]
  inputMemory?: AgentSetup["inputMemory"]
  beforeCompact?: AgentSetup["beforeCompact"]
}

export type HostStatus = {
  open: boolean
  inbox: { waiting: number; claimed: number; submitted: number }
  tasks: number
  submissions: number
}

/** A row key in the wakeups table that is not a wakeup: the time until which a human message is expected. */
const HUMAN_COMING = "human-coming"
/** The longest a burst stays open (MAX_BURST_MS) plus a margin. */
const HUMAN_COMING_MS = 10_000

/** Consecutive failures of one kind before the harness state is rebuilt. */
const RESET_AFTER = 3
/** Failures that come from stored harness state, not from the provider or the network. */
const UNRECOVERABLE = /unresolvable path|unsafe path|sqlite database is closed|malformed/i
/**
 * Processes in a row that opened to unfinished work without the harness going idle in between. A run
 * that kills its process every time (past the memory limit, say) would otherwise resume forever, and
 * every resume calls the model again on the user's key. The count is stored because the process that
 * would count it in memory is the one that dies. Borrowed from the Agents SDK's alarm breaker
 * (cloudflare/agents#1825).
 */
const MAX_RESUMES = 3
const RESUMES_KEY = "crash:resumes"
/** The tables `pi-durable`'s SQLite storage creates (its migrations.ts). Kiko's own tables are kept. */
const PI_DURABLE_TABLES = ["document_revisions", "documents", "submissions", "tasks", "entries", "conversations", "record_ids", "durable_metadata", "durable_schema"]

export class AgentHost {
  readonly inbox: Inbox
  private readonly alarms: Alarms
  private readonly heartbeatMs: number
  private opened?: Promise<Opened>
  private failures = 0
  private watchingIdle = false
  /** This process resumed a dead one's work, so the stored resume count is cleared once idle. */
  private resumed = false

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly options: HostOptions,
  ) {
    this.inbox = new Inbox(ctx.storage)
    this.alarms = createAlarms(ctx)
    this.heartbeatMs = Math.min(options.heartbeatMs ?? HEARTBEAT_MS, HEARTBEAT_MS)
  }

  /**
   * Stores the envelopes and sets the inbox wakeup to now. It touches only this object's own storage,
   * so it cannot wait on another Durable Object or a model. Returns every id of the call: a receipt
   * means "stored", and a repeated id was stored before. A delivery past the inbox caps stores
   * nothing and comes back with `refused`, never as an exception.
   */
  async receive(envelopes: readonly Envelope[], brief: string): Promise<{ admitted: string[]; refused?: Refusal }> {
    const { admitted, inserted, refused } = this.inbox.admit(envelopes, brief)
    if (refused) return { admitted, refused }
    if (inserted > 0) await this.alarms.setWakeup(INBOX_WAKEUP, Date.now())
    return { admitted }
  }

  /**
   * The human pressed stop (section 6.2). Discards every input not yet submitted and asks the alarm
   * to abort the run. Like `receive()`, it touches only this object's storage and returns.
   */
  async stop(): Promise<{ discarded: number }> {
    const discarded = this.inbox.discard()
    await this.ctx.storage.put(STOP_KEY, true)
    await this.alarms.setWakeup(INBOX_WAKEUP, Date.now())
    return { discarded }
  }

  /**
   * The `AgentDO` alarm. Alarms arrive at least once, and every step here is idempotent: the inbox
   * claim is a transaction, and a repeated submit with the same request id is a no-op. A failure
   * re-arms with backoff and returns, so the runtime's six alarm retries are never spent.
   */
  async alarm(): Promise<void> {
    try {
      // The keys only say why the alarm fired. The inbox table and the live tasks say what to do.
      await this.alarms.dueWakeups(Date.now())
      const opened = await this.open()
      await this.drain(opened)
      await this.pulse(opened.harness)
      this.failures = 0
    } catch (error) {
      this.failures++
      // Only the message: a provider error never carries the key, and nothing else is logged.
      const message = error instanceof Error ? error.message : String(error)
      console.error(`agent alarm failed (${this.failures}): ${message}`)
      await this.drop()
      // A harness whose stored state cannot replay (a write lost under SQLITE_BUSY leaves a streaming
      // document that no later delta applies to) fails the same way on every retry, and the agent goes
      // silent for good. After three such failures the harness state is rebuilt and the newest batch is
      // answered again. The room log keeps the transcript, so the agent loses only its private history.
      if (this.failures >= RESET_AFTER && UNRECOVERABLE.test(message)) {
        this.reset()
        this.failures = 0
      }
      // The batches this drain took go back, so the retry submits them at once.
      this.inbox.release()
      const delay = Math.min(RETRY_MS * 2 ** (this.failures - 1), this.heartbeatMs)
      await this.alarms.setWakeup(HEARTBEAT_WAKEUP, Date.now() + delay)
    }
  }

  /**
   * Opens the harness once per process. Opening resumes, because a fresh process may hold tasks that a
   * dead one left unfinished. A live process is never resumed again.
   */
  open(): Promise<Opened> {
    if (this.opened) return this.opened
    const opening = (async () => {
      const setup = await this.options.setup()
      let opened = await this.openHarness(setup)
      if (await this.crashLooping(opened.harness)) {
        // The run is dropped, not resumed. The room log keeps the transcript.
        await opened.harness.close(context).catch(() => {})
        this.reset(false)
        opened = await this.openHarness(setup)
        await this.options.onGiveUp?.()
      }
      await this.options.onOpen?.(opened)
      opened.harness.resume()
      return opened
    })()
    // A failed open is not cached, so the next alarm tries again.
    opening.catch(() => {
      if (this.opened === opening) this.opened = undefined
    })
    this.opened = opening
    return opening
  }

  private async openHarness(setup: AgentSetup): Promise<Opened> {
    const storage = createCoalescingStorage(await SqliteStorage.open(openDurableObjectSqlite(this.ctx.storage)))
    const harness = await Harness.open(storage, { models: setup.models, registry: setup.registry, settings: setup.settings, ...(setup.env ? { env: () => setup.env } : {}) }, context)
    const root = await harness.root(context, { agent: setup.agent })
    return { harness, root, storage, beginRun: setup.beginRun, inputContext: setup.inputContext, inputMemory: setup.inputMemory, beforeCompact: setup.beforeCompact }
  }

  /**
   * Called before `resume()`. Live tasks at open were left by a dead process. True once more than
   * `MAX_RESUMES` processes in a row opened to such work: the caller drops it instead of resuming.
   */
  private async crashLooping(harness: Harness): Promise<boolean> {
    const live = await harness.inspect(context)
    if (live.tasks.length === 0) {
      await this.ctx.storage.delete(RESUMES_KEY)
      return false
    }
    const resumes = ((await this.ctx.storage.get<number>(RESUMES_KEY)) ?? 0) + 1
    if (resumes > MAX_RESUMES) {
      await this.ctx.storage.delete(RESUMES_KEY)
      console.error(`agent run dropped after ${MAX_RESUMES} resumes that never finished`)
      return true
    }
    await this.ctx.storage.put(RESUMES_KEY, resumes)
    this.resumed = true
    return false
  }

  /** The harness went idle: the run chain finished, so the resume count starts over. */
  private async idle(): Promise<void> {
    if (this.resumed) {
      this.resumed = false
      await this.ctx.storage.delete(RESUMES_KEY)
    }
    await this.compact()
  }

  /**
   * Drops pi-durable's tables once `COMPACT_EVERY_RUNS` runs have started from memory, while the agent
   * is idle with nothing waiting. The harness is closed first and opens fresh on the next alarm.
   */
  private async compact(): Promise<void> {
    if (((await this.ctx.storage.get<number>(RUNS_KEY)) ?? 0) < COMPACT_EVERY_RUNS || this.inbox.hasOpen()) return
    const opened = await this.opened
    if (opened) {
      const live = await opened.harness.inspect(context)
      if (live.tasks.length || live.submissions.length) return
      await opened.beforeCompact?.(opened.harness)
    }
    await this.drop()
    this.reset(false)
    await this.ctx.storage.put(RUNS_KEY, 0)
  }

  /** The child conversations of the root, with the task that owns each (P6-05). Opens the harness. */
  async children(): Promise<{ id: string; taskId: string }[]> {
    const { root, storage } = await this.open()
    const page = await storage.scanConversations({ ownerConversationId: root.id }, 100, undefined, context)
    return page.items.map((c) => ({ id: String(c.id), taskId: String(c.owner?.taskId ?? "") }))
  }

  async status(): Promise<HostStatus> {
    const inbox = this.inbox.counts()
    if (!this.opened) return { open: false, inbox, tasks: 0, submissions: 0 }
    const { harness } = await this.opened
    const live = await harness.inspect(context)
    return { open: true, inbox, tasks: live.tasks.length, submissions: live.submissions.length }
  }

  /**
   * Applies a pending stop, then submits every claimed batch as one input each. The mid-run rules
   * (section 6.2) pick how: a restart aborts the run first, a steer joins it after the current tool
   * round, and a queue waits for its answer. A batch claimed before a crash is submitted again with
   * the same request id, which `pi-durable` ignores.
   */
  private async drain({ harness, root, beginRun, inputContext, inputMemory }: Opened): Promise<void> {
    if (await this.ctx.storage.get<boolean>(STOP_KEY)) {
      // Withdraws every queued input and aborts the run's tasks, then waits until the conversation is idle.
      await root.abort(context)
      await this.ctx.storage.delete([STOP_KEY, RESTARTS_KEY])
    }
    for (const batch of await this.inbox.claim()) {
      const run = await this.runState(harness, root)
      // A batch for an idle conversation starts a run. Without credentials it starts nothing.
      if (!run && beginRun && !(await beginRun(batch, root))) {
        this.inbox.submitted(batch.requestId)
        continue
      }
      const action = decide(run, arrivalOf(batch))
      // Only a running root turn holds a batch. Background tasks alone (a subagent) do not.
      const humanSoon = this.humanComingUntil() > Date.now()
      if (arrivalOf(batch).kind === "human") this.ctx.storage.sql.exec("DELETE FROM wakeups WHERE key = ?", HUMAN_COMING)
      // A human message is on its way (the room's burst is still open): agent and system mail waits for it.
      if (humanSoon && arrivalOf(batch).kind !== "human") {
        this.inbox.hold(batch.requestId)
        await this.alarms.setWakeup(INBOX_WAKEUP, this.humanComingUntil())
        continue
      }
      if (action === "hold" && (await this.rootPlaced(harness, root))) {
        // The batch waits in the inbox. `watchIdle` sets the inbox wakeup when the run answers.
        this.inbox.hold(batch.requestId)
        continue
      }
      // The restart count belongs to the run chain. A submit to an idle conversation starts a new one.
      let restarts = run?.restarts ?? 0
      if (action === "restart") {
        // The run showed nothing yet. The aborted partial is dropped and its input stays in the
        // transcript, so the model answers both turns at once.
        await root.abort(context)
        restarts++
      }
      await this.ctx.storage.put(RESTARTS_KEY, restarts)
      const whenBusy = action === "steer" ? ({ whenBusy: "steer" } as const) : {}
      // Section 13. A new run either goes on with the transcript plus what is new in the chat, or, when
      // the transcript is empty or past its budget, starts over from the <memory> block. A restart and a
      // steer keep their context, since the aborted burst must stay in view.
      let memory: string | undefined
      if (!run && inputMemory) {
        const out = await inputMemory(batch, await this.contextFull(root))
        if (out.fresh) await root.reset(undefined, context)
        await this.ctx.storage.put(RUNS_KEY, ((await this.ctx.storage.get<number>(RUNS_KEY)) ?? 0) + 1)
        memory = out.text
      }
      const extra = await inputContext?.()
      const content = renderInput(extra ? { ...batch, briefs: [...batch.briefs, extra] } : batch, memory)
      await root.submit({ type: "input", content, requestId: batch.requestId, ...whenBusy }, context)
      this.inbox.submitted(batch.requestId)
    }
  }

  /** True when the model's view holds no input yet, or more than `CONTEXT_BUDGET_CHARS` of text. */
  private async contextFull(root: Conversation): Promise<boolean> {
    const view = await root.context(context)
    let chars = 0
    let inputs = 0
    for (const entry of view.entries) {
      if (entry.kind === "pi.user") inputs++
      for (const m of (entry.model ?? []) as unknown as { content?: string | { type: string; text?: string; thinking?: string; arguments?: unknown }[] }[]) {
        if (typeof m.content === "string") chars += m.content.length
        else for (const p of m.content ?? []) chars += (p.text?.length ?? 0) + (p.thinking?.length ?? 0) + (p.arguments ? JSON.stringify(p.arguments).length : 0)
      }
    }
    return inputs === 0 || chars > CONTEXT_BUDGET_CHARS
  }

  /** The root conversation's run, or null when it is idle. */
  private async runState(harness: Harness, root: Conversation): Promise<RunState | null> {
    const live = await harness.inspect(context)
    const mine = live.submissions.filter((s) => s.conversationId === root.id)
    if (!mine.some((s) => s.status === "placed") && live.tasks.length === 0) return null
    return {
      ...(this.options.progress?.() ?? FRESH_RUN),
      queued: mine.some((s) => s.status === "queued"),
      restarts: (await this.ctx.storage.get<number>(RESTARTS_KEY)) ?? 0,
    }
  }

  /**
   * Section 7.8. The room says a human message is in its burst window. Until it arrives (or
   * `HUMAN_COMING_MS` passes), no agent or system batch is placed. Stored as a row in the wakeups
   * table's sibling key so it survives eviction; it is a hint, so a lost one only costs ordering.
   */
  humanComing(): void {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO wakeups (key, at) VALUES (?, ?)", HUMAN_COMING, Date.now() + HUMAN_COMING_MS)
  }

  /** A human message waits in the inbox or in the room's open burst. A waiting tool stops for it (section 7.8). */
  humanWaiting(): boolean {
    return this.inbox.humanWaiting() || this.humanComingUntil() > Date.now()
  }

  private humanComingUntil(): number {
    return this.ctx.storage.sql.exec<{ at: number }>("SELECT at FROM wakeups WHERE key = ?", HUMAN_COMING).toArray()[0]?.at ?? 0
  }

  /** True while a root input is placed, that is, while the root conversation is answering. */
  private async rootPlaced(harness: Harness, root: Conversation): Promise<boolean> {
    const live = await harness.inspect(context)
    return live.submissions.some((s) => s.conversationId === root.id && s.status === "placed")
  }

  /** Keeps the heartbeat while any task or submission is live, and removes it once the harness is idle. */
  private async pulse(harness: Harness): Promise<void> {
    const live = await harness.inspect(context)
    if (live.tasks.length === 0 && live.submissions.length === 0) {
      await this.alarms.clearWakeup(HEARTBEAT_WAKEUP)
      await this.idle()
      this.options.onIdle?.()
      // The run answered between the drain's check and now, so a batch it held is placed at once.
      if (this.inbox.hasOpen()) await this.alarms.setWakeup(INBOX_WAKEUP, Date.now())
      return
    }
    await this.alarms.setWakeup(HEARTBEAT_WAKEUP, Date.now() + this.heartbeatMs)
    this.watchIdle(harness)
  }

  /**
   * Removes the heartbeat when the run ends, which saves the one alarm that would only find the harness
   * idle. It checks again before clearing, and the clear runs in the same turn as that check, so a
   * submit that landed in between keeps its heartbeat.
   */
  private watchIdle(harness: Harness): void {
    if (this.watchingIdle) return
    this.watchingIdle = true
    harness
      .waitForIdle(context)
      .then(async () => {
        this.watchingIdle = false
        const live = await harness.inspect(context)
        // A held agent or system batch is placed now that the run answered (section 7.8).
        if (this.inbox.hasOpen()) await this.alarms.setWakeup(INBOX_WAKEUP, Date.now())
        if (live.tasks.length === 0 && live.submissions.length === 0) {
          await this.alarms.clearWakeup(HEARTBEAT_WAKEUP)
          await this.idle()
          this.options.onIdle?.()
        } else this.watchIdle(harness)
      })
      .catch(() => {
        // The harness closed or failed. The heartbeat stays armed and the next alarm reopens it.
        this.watchingIdle = false
      })
  }

  /**
   * Drops every `pi-durable` table and the outbox's run state. With `requeue`, the newest batch goes
   * back in the inbox to be answered again; the breaker passes false, since that batch is the one
   * that kept failing.
   */
  private reset(requeue = true): void {
    const sql = this.ctx.storage.sql
    for (const table of PI_DURABLE_TABLES) sql.exec(`DROP TABLE IF EXISTS ${table}`)
    sql.exec("DELETE FROM outbox")
    if (!requeue) return
    const newest = sql
      .exec<{ request_id: string }>("SELECT request_id FROM inbox WHERE submitted = 1 AND request_id IS NOT NULL AND request_id != 'stopped' ORDER BY arrival DESC LIMIT 1")
      .toArray()[0]
    if (newest) sql.exec("UPDATE inbox SET submitted = 0, in_flight_at = NULL, in_flight_by = NULL WHERE request_id = ?", newest.request_id)
    console.error("agent harness reset after repeated unrecoverable failures")
  }

  /** Forgets the harness after a failure. A fatal storage error poisons the session, so it is never reused. */
  private async drop(): Promise<void> {
    const opened = this.opened
    this.opened = undefined
    if (!opened) return
    await opened.then((o) => o.harness.close(context)).catch(() => {})
  }
}

/** A batch with any human envelope is a human arrival. */
function arrivalOf(batch: Batch): Arrival {
  return { kind: batch.envelopes.some((e) => e.from.kind === "human") ? "human" : (batch.envelopes[0]?.from.kind ?? "system") }
}
