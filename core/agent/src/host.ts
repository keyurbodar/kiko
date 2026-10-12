import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Models } from "@earendil-works/pi-ai"
import { type AgentChange, type Conversation, type ConversationId, Harness, type HarnessSettings, type RegistryReader, type TaskId, type ToolTaskInput } from "@earendil-works/pi-durable"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { type Alarms, createAlarms } from "@yuki/durable/alarm"
import { type CoalescingStorage, createCoalescingStorage } from "./coalescing-storage"
import { type Batch, Inbox, type Refusal, renderInput } from "./inbox"
import { stoppable } from "./effects"
import { type Arrival, decide, FRESH_RUN, type RunProgress, type RunState } from "./mid-run"
import { type Envelope, joinOrigin, type Origin, originOfAll } from "./envelope"
import { openDurableObjectSqlite } from "./sqlite"
import { Workers } from "./workers"

const context = BACKGROUND_CONTEXT

export const INBOX_WAKEUP = "inbox"
export const HEARTBEAT_WAKEUP = "heartbeat"
const HEARTBEAT_MS = 30_000
const RETRY_MS = 1_000
export const CONTEXT_BUDGET_CHARS = 60_000
export const TASK_BUDGET_CHARS = 240_000
export const TASK_IDLE_MS = 15 * 60_000

export type Transcript = { inputs: number; chars: number; toolChars: number; idleMs: number }

type ModelMessage = { role?: string; content?: string | { type: string; text?: string; thinking?: string; arguments?: unknown }[] }

export function measure(entries: readonly { kind: string; model?: readonly unknown[] }[], idleMs: number): Transcript {
  const t: Transcript = { inputs: 0, chars: 0, toolChars: 0, idleMs }
  for (const entry of entries) {
    const first = entry.kind === "pi.user" && t.inputs === 0
    if (entry.kind === "pi.user") t.inputs++
    for (const m of (entry.model ?? []) as ModelMessage[]) {
      let n = 0
      if (typeof m.content === "string") n = m.content.length - (first ? opening(m.content) : 0)
      else for (const p of m.content ?? []) n += (p.text?.length ?? 0) - (first ? opening(p.text ?? "") : 0) + (p.thinking?.length ?? 0) + (p.arguments ? JSON.stringify(p.arguments).length : 0)
      t.chars += n
      if (m.role === "toolResult") t.toolChars += n
    }
  }
  return t
}

function opening(text: string): number {
  if (!text.startsWith("<memory>")) return 0
  const end = text.indexOf("</memory>")
  return end < 0 ? 0 : end + "</memory>".length
}

export function briefToShow(
  briefs: readonly string[],
  fresh: boolean,
  last: string | undefined,
  shorten: (brief: string) => string = (brief) => brief,
): { brief?: string; key?: string } {
  const newest = briefs.at(-1)
  if (newest === undefined) return {}
  const short = shorten(newest)
  const key = hashText(short)
  if (!fresh && key === last) return { key }
  return { brief: fresh ? newest : short, key }
}

function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16)
}

export function startsFresh(t: Transcript): boolean {
  if (t.inputs === 0) return true
  if (t.chars <= CONTEXT_BUDGET_CHARS) return false
  const working = t.toolChars * 2 > t.chars && t.idleMs < TASK_IDLE_MS
  return !working || t.chars > TASK_BUDGET_CHARS
}
export const COMPACT_EVERY_RUNS = 50
export const RUNS_KEY = "runs:since-compact"
const LAST_RUN_KEY = "runs:last-at"
const COMPACT_DUE_KEY = "compact:due"
const STOP_KEY = "mid-run:stop"
const RESTARTS_KEY = "mid-run:restarts"
const BRIEF_KEY = "brief:last"
const JOINED_KEY = "memory:joined"

export type AgentSetup = {
  models: Models
  registry: RegistryReader
  agent: AgentChange
  settings?: HarnessSettings
  env?: (conversationId: ConversationId) => ExecutionEnv
  beginRun?: (batch: Batch, root: Conversation) => Promise<boolean>
  joinRun?: (batch: Batch, root: Conversation) => Promise<void>
  inputContext?: () => Promise<string | undefined>
  inputMemory?: (batch: Batch, fresh: boolean, joined: number[]) => Promise<{ text?: string; fresh: boolean }>
  beforeCompact?: (harness: Harness) => Promise<void>
  stale?: () => Promise<boolean>
}

export type HostOptions = {
  setup: () => AgentSetup | Promise<AgentSetup>
  onOpen?: (opened: Opened) => void | Promise<void>
  onGiveUp?: () => void | Promise<void>
  heartbeatMs?: number
  progress?: () => RunProgress | null
  onIdle?: () => void
  onTimeout?: () => void | Promise<void>
  shortBrief?: (brief: string) => string
  onReset?: () => void
  autoBudgetMs?: () => Promise<number>
  onWorkers?: (running: number, pending: boolean) => void
  // Keeps an un-awaited promise alive past the handler's return, so an abort still commits.
  waitUntil: (work: Promise<unknown>) => void
}

export type Opened = {
  harness: Harness
  root: Conversation
  registry: AgentSetup["registry"]
  storage: CoalescingStorage
  beginRun?: AgentSetup["beginRun"]
  joinRun?: AgentSetup["joinRun"]
  inputContext?: AgentSetup["inputContext"]
  inputMemory?: AgentSetup["inputMemory"]
  beforeCompact?: AgentSetup["beforeCompact"]
  stale?: AgentSetup["stale"]
}

export type HostStatus = {
  open: boolean
  inbox: { waiting: number; claimed: number; submitted: number }
  tasks: number
  submissions: number
}

const TOOL_TASK = "pi.tool"
const HUMAN_COMING = "human-coming"
const HUMAN_COMING_MS = 10_000

export const AUTO_RUN_BUDGET_MS = 10 * 60_000

const RESET_AFTER = 3
const UNRECOVERABLE = /unresolvable path|unsafe path|sqlite database is closed|malformed/i
const MAX_RESUMES = 3
const RESUMES_KEY = "crash:resumes"
const PI_DURABLE_TABLES = ["document_revisions", "documents", "submissions", "tasks", "entries", "conversations", "record_ids", "durable_metadata", "durable_schema"]

export class AgentHost {
  readonly inbox: Inbox
  readonly workers: Workers
  private readonly alarms: Alarms
  private readonly heartbeatMs: number
  private opened?: Promise<Opened>
  private failures = 0
  private watchingIdle = false
  private resumed = false
  // Bumped when input is joined and again once it is submitted. An idle check that saw it move must not wipe the new run's origin.
  private inputs = 0

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly options: HostOptions,
  ) {
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS harness_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)")
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS run_origin (id INTEGER PRIMARY KEY CHECK (id = 1), origin TEXT NOT NULL, started_at INTEGER NOT NULL, steered INTEGER NOT NULL DEFAULT 0)")
    this.inbox = new Inbox(ctx.storage)
    this.workers = new Workers(ctx.storage, { deliver: (envelope) => this.receive([envelope], ""), origin: () => this.origin(), onChange: (running) => options.onWorkers?.(running, this.inbox.hasOpen()) })
    this.alarms = createAlarms(ctx)
    this.heartbeatMs = Math.min(options.heartbeatMs ?? HEARTBEAT_MS, HEARTBEAT_MS)
  }

  async receive(envelopes: readonly Envelope[], brief: string): Promise<{ admitted: string[]; refused?: Refusal }> {
    const { admitted, inserted, refused } = this.inbox.admit(envelopes, brief)
    if (refused) return { admitted, refused }
    if (inserted > 0) await this.alarms.setWakeup(INBOX_WAKEUP, Date.now())
    return { admitted }
  }

  async stop(): Promise<{ discarded: number }> {
    const discarded = this.inbox.discard()
    await this.ctx.storage.put(STOP_KEY, true)
    await this.alarms.setWakeup(INBOX_WAKEUP, Date.now())
    return { discarded }
  }

  async alarm(): Promise<void> {
    try {
      await this.alarms.dueWakeups(Date.now())
      await this.compactIfDue()
      const opened = await this.current()
      await this.drain(opened)
      await this.enforceBudget(opened)
      await this.pulse(opened)
      this.failures = 0
    } catch (error) {
      this.failures++
      const message = error instanceof Error ? error.message : String(error)
      console.error(`agent alarm failed (${this.failures}): ${message}`)
      await this.drop()
      if (this.failures >= RESET_AFTER && UNRECOVERABLE.test(message)) {
        this.reset()
        this.failures = 0
      }
      this.inbox.release()
      const delay = Math.min(RETRY_MS * 2 ** (this.failures - 1), this.heartbeatMs)
      await this.alarms.setWakeup(HEARTBEAT_WAKEUP, Date.now() + delay)
    }
  }

  open(): Promise<Opened> {
    if (this.opened) return this.opened
    const opening = (async () => {
      const setup = await this.options.setup()
      let opened = await this.openHarness(setup)
      if (await this.crashLooping(opened)) {
        await opened.harness.close(context).catch(() => {})
        this.reset(false)
        opened = await this.openHarness(setup)
        await this.options.onGiveUp?.()
      }
      await this.options.onOpen?.(opened)
      opened.harness.resume()
      this.workers.rearm(opened.harness)
      await this.workers.resumed(opened.harness)
      return opened
    })()
    opening.catch(() => {
      if (this.opened === opening) this.opened = undefined
    })
    this.opened = opening
    return opening
  }

  private async current(): Promise<Opened> {
    const opened = await this.open()
    if (!opened.stale || !this.inbox.hasOpen()) return opened
    const live = await opened.harness.inspect(context)
    if (live.tasks.length || live.submissions.length || !(await opened.stale())) return opened
    await this.drop()
    return this.open()
  }

  private async openHarness(setup: AgentSetup): Promise<Opened> {
    const storage = createCoalescingStorage(await SqliteStorage.open(openDurableObjectSqlite(this.ctx.storage)))
    const env = setup.env
    const harness = await Harness.open(storage, { models: setup.models, registry: setup.registry, settings: setup.settings, ...(env ? { env: (target) => env(target.conversationId) } : {}) }, context)
    const root = await harness.root(context, { agent: setup.agent })
    return { harness, root, registry: setup.registry, storage, beginRun: setup.beginRun, joinRun: setup.joinRun, inputContext: setup.inputContext, inputMemory: setup.inputMemory, beforeCompact: setup.beforeCompact, stale: setup.stale }
  }

  private async crashLooping({ harness, root }: Opened): Promise<boolean> {
    const live = await harness.inspect(context)
    if (!live.tasks.some((t) => t.record.conversationId === root.id)) {
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

  private async idle(): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM run_origin")
    if (this.resumed) {
      this.resumed = false
      await this.ctx.storage.delete(RESUMES_KEY)
    }
    await this.compact()
  }

  private async compact(): Promise<void> {
    if (((await this.ctx.storage.get<number>(RUNS_KEY)) ?? 0) >= COMPACT_EVERY_RUNS) await this.ctx.storage.put(COMPACT_DUE_KEY, true)
  }

  private async compactIfDue(): Promise<void> {
    if (!(await this.ctx.storage.get<boolean>(COMPACT_DUE_KEY))) return
    const opened = await this.open()
    const live = await opened.harness.inspect(context)
    if (live.tasks.length || live.submissions.length) return
    await opened.beforeCompact?.(opened.harness)
    await this.drop()
    this.reset(false)
    await this.ctx.storage.put(RUNS_KEY, 0)
    await this.ctx.storage.delete(COMPACT_DUE_KEY)
  }

  async status(): Promise<HostStatus> {
    const inbox = this.inbox.counts()
    if (!this.opened) return { open: false, inbox, tasks: 0, submissions: 0 }
    const { harness } = await this.opened
    const live = await harness.inspect(context)
    return { open: true, inbox, tasks: live.tasks.length, submissions: live.submissions.length }
  }

  private async drain({ harness, root, registry, storage, beginRun, joinRun, inputContext, inputMemory }: Opened): Promise<void> {
    if (await this.ctx.storage.get<boolean>(STOP_KEY)) {
      this.workers.stopAll()
      await root.abort(context)
      await this.ctx.storage.delete([STOP_KEY, RESTARTS_KEY])
    }
    for (const batch of await this.inbox.claim()) {
      if (await storage.submissionByRequest(root.id, batch.requestId, context)) {
        this.inbox.submitted(batch.requestId)
        continue
      }
      const arrival = arrivalOf(batch)
      const run = await this.runState(harness, root)
      const action = decide(run, arrival)
      const humanSoon = this.humanComingUntil() > Date.now()
      if (arrival.kind === "human") this.ctx.storage.sql.exec("DELETE FROM wakeups WHERE key = ?", HUMAN_COMING)
      if (humanSoon && arrival.kind !== "human") {
        this.inbox.hold(batch.requestId)
        await this.alarms.setWakeup(INBOX_WAKEUP, this.humanComingUntil())
        continue
      }
      if (action === "hold" && (await this.rootPlaced(harness, root))) {
        this.inbox.hold(batch.requestId)
        continue
      }
      if (!run && beginRun && !(await beginRun(batch, root))) {
        this.inbox.submitted(batch.requestId)
        continue
      }
      if (run) await joinRun?.(batch, root)
      let restarts = run?.restarts ?? 0
      if (action === "restart") {
        await root.abort(context)
        restarts++
      }
      await this.ctx.storage.put(RESTARTS_KEY, restarts)
      // Read before the steer: a tool the steer starts must not be stopped by it.
      const stopping = run && action === "interrupt" ? await this.stoppableTools(harness, root, registry, run.tools) : []
      const whenBusy = action === "steer" || action === "interrupt" ? ({ whenBusy: "steer" } as const) : {}
      let memory: string | undefined
      let fresh = false
      if (!run && inputMemory) {
        const out = await inputMemory(batch, await this.contextFull(root), await this.joinedSeqs())
        fresh = out.fresh
        if (out.fresh) {
          await root.reset(undefined, context)
          await this.ctx.storage.put(RUNS_KEY, ((await this.ctx.storage.get<number>(RUNS_KEY)) ?? 0) + 1)
        }
        await this.ctx.storage.put(LAST_RUN_KEY, Date.now())
        await this.ctx.storage.delete(JOINED_KEY)
        memory = out.text
      }
      this.joinOrigin(batch, !run || action === "restart" || !(await this.rootPlaced(harness, root)))
      const [extra, last] = await Promise.all([inputContext?.(), this.ctx.storage.get<{ epoch: number; key: string }>(BRIEF_KEY)])
      const shown = briefToShow(batch.briefs, fresh, last?.epoch === this.epoch() ? last.key : undefined, this.options.shortBrief)
      const work = this.workers.note()
      const content = renderInput({ ...batch, briefs: [...(shown.brief ? [shown.brief] : []), ...(extra ? [extra] : []), ...(work ? [work] : [])] }, memory)
      // Abort before submit: a crash after the submit must not leave the stopped tool running.
      for (const id of stopping) this.options.waitUntil(harness.abortTask(id, context).catch(() => {}))
      await root.submit({ type: "input", content, requestId: batch.requestId, ...whenBusy }, context)
      this.inbox.submitted(batch.requestId)
      this.inputs++
      if (shown.key) await this.ctx.storage.put(BRIEF_KEY, { epoch: this.epoch(), key: shown.key })
      if (run) await this.ctx.storage.put(JOINED_KEY, [...(await this.joinedSeqs()), ...batch.envelopes.map((e) => e.seq)].slice(-500))
    }
  }

  private joinOrigin(batch: Batch, fresh: boolean): void {
    this.inputs++
    const incoming = originOfAll(batch.envelopes) ?? "auto"
    const row = this.ctx.storage.sql.exec<{ origin: Origin }>("SELECT origin FROM run_origin WHERE id = 1").toArray()[0]
    if (fresh || !row) {
      this.ctx.storage.sql.exec(
        "INSERT INTO run_origin (id, origin, started_at, steered) VALUES (1, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET origin = excluded.origin, started_at = excluded.started_at, steered = 0",
        incoming,
        Date.now(),
      )
      return
    }
    this.ctx.storage.sql.exec("UPDATE run_origin SET origin = ? WHERE id = 1", joinOrigin(row.origin, incoming))
  }

  origin(): Origin {
    const row = this.ctx.storage.sql.exec<{ origin: Origin }>("SELECT origin FROM run_origin WHERE id = 1").toArray()[0]
    return row?.origin ?? "auto"
  }

  private async enforceBudget({ harness, root }: Opened): Promise<void> {
    const row = this.ctx.storage.sql.exec<{ origin: Origin; started_at: number; steered: number }>("SELECT origin, started_at, steered FROM run_origin WHERE id = 1").toArray()[0]
    if (!row || row.origin === "human") return
    const age = Date.now() - row.started_at
    const budget = (await this.options.autoBudgetMs?.()) ?? AUTO_RUN_BUDGET_MS
    if (age < budget) return
    if (!(await this.runState(harness, root))) return
    if (age >= 2 * budget) {
      await this.options.onTimeout?.()
      await root.abort(context)
      this.ctx.storage.sql.exec("DELETE FROM run_origin")
      return
    }
    if (row.steered) return
    const content = '<system-event reason="run_budget">\ntime is up for this run. post what you have now in one short message, and stop.\n</system-event>'
    await root.submit({ type: "input", content, requestId: `budget:${row.started_at}`, whenBusy: "steer" }, context)
    this.ctx.storage.sql.exec("UPDATE run_origin SET steered = 1 WHERE id = 1")
  }

  // The running tools the host may stop, so a human message is answered after the tool, not after it finishes.
  private async stoppableTools(harness: Harness, root: Conversation, registry: AgentSetup["registry"], tools: ReadonlyMap<string, string>): Promise<TaskId[]> {
    const live = await harness.inspect(context)
    const installed = registry.snapshot().tools()
    const ids: TaskId[] = []
    for (const task of live.tasks) {
      if (task.record.kind !== TOOL_TASK || task.record.conversationId !== root.id || task.state.kind !== "running") continue
      const name = tools.get((task.record.input as ToolTaskInput).callId)
      const tool = installed.find((t) => t.tool.name === name)?.tool
      if (tool && stoppable(tool)) ids.push(task.record.id)
    }
    return ids
  }

  private async contextFull(root: Conversation): Promise<boolean> {
    const view = await root.context(context)
    return startsFresh(measure(view.entries, Date.now() - ((await this.ctx.storage.get<number>(LAST_RUN_KEY)) ?? 0)))
  }

  async joinedSeqs(): Promise<number[]> {
    return (await this.ctx.storage.get<number[]>(JOINED_KEY)) ?? []
  }

  private async runState(harness: Harness, root: Conversation): Promise<RunState | null> {
    const live = await harness.inspect(context)
    const mine = live.submissions.filter((s) => s.conversationId === root.id)
    if (!mine.some((s) => s.status === "placed") && !live.tasks.some((t) => t.record.conversationId === root.id)) return null
    return {
      ...(this.options.progress?.() ?? FRESH_RUN),
      queued: mine.some((s) => s.status === "queued"),
      restarts: (await this.ctx.storage.get<number>(RESTARTS_KEY)) ?? 0,
    }
  }

  humanComing(): void {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO wakeups (key, at) VALUES (?, ?)", HUMAN_COMING, Date.now() + HUMAN_COMING_MS)
  }

  async humanGone(): Promise<void> {
    if (!this.ctx.storage.sql.exec("DELETE FROM wakeups WHERE key = ?", HUMAN_COMING).rowsWritten) return
    if (this.inbox.hasOpen()) await this.alarms.setWakeup(INBOX_WAKEUP, Date.now())
  }

  async rootId(): Promise<ConversationId | null> {
    return this.opened ? (await this.opened).root.id : null
  }

  epoch(): number {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM harness_epoch WHERE id = 1").toArray()[0]?.n ?? 0
  }

  humanWaiting(): boolean {
    return this.inbox.humanWaiting() || this.humanComingUntil() > Date.now()
  }

  private humanComingUntil(): number {
    return this.ctx.storage.sql.exec<{ at: number }>("SELECT at FROM wakeups WHERE key = ?", HUMAN_COMING).toArray()[0]?.at ?? 0
  }

  private async rootPlaced(harness: Harness, root: Conversation): Promise<boolean> {
    const live = await harness.inspect(context)
    return live.submissions.some((s) => s.conversationId === root.id && s.status === "placed")
  }

  // Only an idle harness clears the heartbeat, which must outlive an eviction mid-work.
  private async pulse({ harness, root }: Opened): Promise<void> {
    const seen = this.inputs
    const live = await harness.inspect(context)
    const talking = isTalking(live, root.id)
    // Nothing awaits between the check and the delete, so no input can join in between.
    if (!talking && this.inputs === seen) this.ctx.storage.sql.exec("DELETE FROM run_origin")
    if (live.tasks.length === 0 && live.submissions.length === 0 && this.inputs === seen) {
      await this.idle()
      await this.alarms.clearWakeup(HEARTBEAT_WAKEUP)
      this.options.onIdle?.()
      if (this.inbox.hasOpen()) await this.alarms.setWakeup(INBOX_WAKEUP, Date.now())
      return
    }
    await this.alarms.setWakeup(HEARTBEAT_WAKEUP, Date.now() + this.heartbeatMs)
    if (talking) this.watchIdle(harness, root)
  }

  // Waits for the talker, not the harness: harness.waitForIdle also waits on every worker.
  private watchIdle(harness: Harness, root: Conversation): void {
    if (this.watchingIdle) return
    this.watchingIdle = true
    root
      .waitForIdle(context)
      .then(async () => {
        this.watchingIdle = false
        const seen = this.inputs
        const live = await harness.inspect(context)
        if (this.inbox.hasOpen()) await this.alarms.setWakeup(INBOX_WAKEUP, Math.max(Date.now(), this.humanComingUntil()))
        if (isTalking(live, root.id) || this.inputs !== seen) return this.watchIdle(harness, root)
        this.ctx.storage.sql.exec("DELETE FROM run_origin")
        if (live.tasks.length || live.submissions.length) return
        await this.idle()
        await this.alarms.clearWakeup(HEARTBEAT_WAKEUP)
        this.options.onIdle?.()
      })
      .catch(() => {
        this.watchingIdle = false
      })
  }

  private reset(requeue = true): void {
    const sql = this.ctx.storage.sql
    for (const table of PI_DURABLE_TABLES) sql.exec(`DROP TABLE IF EXISTS ${table}`)
    sql.exec("INSERT INTO harness_epoch (id, n) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET n = n + 1")
    this.workers.forget()
    this.options.onReset?.()
    if (!requeue) return
    const newest = sql
      .exec<{ request_id: string }>("SELECT request_id FROM inbox WHERE submitted = 1 AND request_id IS NOT NULL AND request_id != 'stopped' ORDER BY arrival DESC LIMIT 1")
      .toArray()[0]
    if (newest) sql.exec("UPDATE inbox SET submitted = 0, in_flight_at = NULL, in_flight_by = NULL WHERE request_id = ?", newest.request_id)
    console.error("agent harness reset after repeated unrecoverable failures")
  }

  async shutdown(): Promise<void> {
    const opened = await this.opened?.catch(() => undefined)
    this.opened = undefined
    if (!opened) return
    await opened.root.abort(context, { background: true }).catch(() => {})
    await opened.harness.close(context).catch(() => {})
  }

  private async drop(): Promise<void> {
    const opened = this.opened
    this.opened = undefined
    if (!opened) return
    await opened.then((o) => o.harness.close(context)).catch(() => {})
  }
}

function isTalking(live: { tasks: readonly { record: { conversationId: ConversationId } }[]; submissions: readonly { conversationId: ConversationId }[] }, root: ConversationId): boolean {
  return live.tasks.some((t) => t.record.conversationId === root) || live.submissions.some((s) => s.conversationId === root)
}

function arrivalOf(batch: Batch): Arrival {
  return { kind: batch.envelopes.some((e) => e.from.kind === "human") ? "human" : (batch.envelopes[0]?.from.kind ?? "system") }
}
