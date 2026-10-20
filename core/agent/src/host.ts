import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Models } from "@earendil-works/pi-ai"
import { type AgentChange, type Conversation, type ConversationId, Harness, type HarnessSettings, type Storage, type RegistryReader, type TaskId, type TaskInspection } from "@earendil-works/pi-durable"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import type { Step } from "@kiko/durable/migrate"
import { JournalStorage } from "./journal"
import { continueAtBoundary } from "./continuation"
import { submitPaused } from "./admission"
import { type Batch, type Refusal, renderInput, requestIdFor } from "./input"
import { FRESH_RUN, type RunProgress, type RunState } from "./mid-run"
import type { Envelope } from "./envelope"
import { WORKERS_RUN, WORKERS_STEPS, WORKERS_TAIL, Workers } from "./workers"

const context = BACKGROUND_CONTEXT

export const INBOX_WAKEUP = "inbox"
export const CONTEXT_BUDGET_CHARS = 60_000
export const TASK_BUDGET_CHARS = 240_000
export const TASK_IDLE_MS = 15 * 60_000

export type Transcript = { inputs: number; chars: number; toolChars: number; idleMs: number }

type ModelMessage = { role?: string; content?: string | { type: string; text?: string; thinking?: string; arguments?: unknown }[] }

export function measure(entries: readonly { kind: string; model?: readonly unknown[] }[], idleMs: number): Transcript {
  const t: Transcript = { inputs: 0, chars: 0, toolChars: 0, idleMs }
  for (const entry of entries) {
    const first = (entry.kind === "pi.user" || entry.kind === "kiko.input") && t.inputs === 0
    if (entry.kind === "pi.user" || entry.kind === "kiko.input") t.inputs++
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
const LAST_RUN_KEY = "runs:last-at"
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
  inputInvalidated?: () => Promise<"refresh" | "forget" | null>
  inputMemory?: (batch: Batch, fresh: boolean, joined: number[]) => Promise<{ text?: string; fresh: boolean }>
  beforeCompact?: (harness: Harness) => Promise<void>
  stale?: () => Promise<boolean>
}

export type HostOptions = {
  /** Persist pi input while paused, then ask the owner to dispatch a run RPC. */
  requestRun?: (requestId: string) => void | Promise<void>
  clock: Alarms
  projectTasks: (tasks: readonly TaskInspection[], watches: ReadonlyMap<TaskId, number>, current: number | undefined) => { next: number | undefined; resume: { id: TaskId; deadline: number }[] }
  openHarness?: (storage: Storage, setup: AgentSetup) => Promise<Harness>
  setup: () => AgentSetup | Promise<AgentSetup>
  onOpen?: (opened: Opened) => void | Promise<void>
  onGiveUp?: () => void | Promise<void>
  scheduledDeadline?: (task: TaskInspection) => number | undefined
  /** Project recovery onto the owner clock; undefined clears this agent's recovery deadline. */
  recoveryDeadline?: (at: number | undefined) => Promise<void>
  progress?: () => RunProgress | null
  onIdle?: () => void
  shortBrief?: (brief: string) => string
  onReset?: () => void
  onError?: (error: unknown, requestId: string) => void | Promise<void>
  onWorkers?: (running: number, pending: boolean) => void
  // Keeps an un-awaited promise alive past the handler's return, so an abort still commits.
  waitUntil: (work: Promise<unknown>) => void
}

export type Opened = {
  harness: Harness
  root: Conversation
  storage: JournalStorage
  setup: AgentSetup
}

export type HostStatus = {
  open: boolean
  inbox: { waiting: number; claimed: number; submitted: number }
  tasks: number
  submissions: number
}

const HUMAN_COMING = "human-coming"
const HUMAN_COMING_MS = 10_000

const RECOVERY_WAKEUP = "recovery"
const RECOVERY_DELAY_MS = 60_000

const MAX_RESUMES = 3
const RESUMES_KEY = "crash:resumes"
const EXTENSIONS_KEY = "agent:extensions"

const INBOX_STEPS: Step[] = [
  `CREATE TABLE IF NOT EXISTS inbox (
    id TEXT PRIMARY KEY,
    arrival INTEGER NOT NULL,
    priority INTEGER NOT NULL,
    envelope TEXT NOT NULL,
    brief TEXT NOT NULL,
    request_id TEXT,
    submitted INTEGER NOT NULL DEFAULT 0,
    in_flight_at INTEGER,
    in_flight_by TEXT,
    at INTEGER
  ) STRICT`,
  "CREATE INDEX IF NOT EXISTS inbox_open ON inbox (submitted, request_id, priority, arrival)",
  "CREATE TABLE IF NOT EXISTS inbox_state (id INTEGER PRIMARY KEY CHECK (id = 1), arrival INTEGER NOT NULL, pruned_at INTEGER NOT NULL)",
]


// Everything the host's objects store. Its object's schema list spreads this, so the host adds its tables in one place.
export const HOST_STEPS: Step[] = [
  ...INBOX_STEPS,
  ...WORKERS_STEPS,
  "CREATE TABLE IF NOT EXISTS harness_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS run_origin (id INTEGER PRIMARY KEY CHECK (id = 1), origin TEXT NOT NULL, started_at INTEGER NOT NULL, steered INTEGER NOT NULL DEFAULT 0)",
]

// What the host retired. The object that spreads HOST_STEPS appends these after its own steps, so no earlier step moves.
export const HOST_TAIL: Step[] = [...WORKERS_TAIL, "DROP TABLE IF EXISTS run_origin", ...WORKERS_RUN]

export class AgentHost {
  readonly workers: Workers
  private readonly alarms: Alarms
  private opened?: Promise<Opened>
  private plannedSetup?: AgentSetup
  private invocation?: { due: () => boolean; boundary?: Awaited<ReturnType<typeof continueAtBoundary>> }
  private failure?: Promise<void>
  private compaction?: Promise<void>
  private draining = 0
  private readonly retiring = new WeakSet<Opened>()
  private resumed = false
  private alarmUpdate: Promise<void> = Promise.resolve()
  private readonly taskWatches = new WeakMap<Harness, Map<TaskId, number>>()
  // An idle check that saw input move must wait for the new work too.
  private inputs = 0

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly options: HostOptions,
  ) {
    this.workers = new Workers(ctx.storage, { deliver: (envelope) => this.receive([envelope], ""), onChange: (running) => options.onWorkers?.(running, false) })
    this.alarms = options.clock
  }

  private invalidated = false
  private admission: Promise<unknown> = Promise.resolve()

  async receive(envelopes: readonly Envelope[], brief: string, requestId?: string): Promise<{ admitted: string[]; refused?: Refusal }> {
    if (envelopes.some((e) => new TextEncoder().encode(JSON.stringify(e) + brief).byteLength > 128 * 1024)) return { admitted: [], refused: "too_large" }
    const batch: Batch = { requestId: requestId ?? (envelopes.length === 1 && envelopes[0]?.from.kind !== "human" ? envelopes[0]!.id : await requestIdFor(envelopes.map((e) => e.id))), envelopes: [...envelopes], briefs: brief ? [brief] : [] }
    const submit = this.admission.then(async () => {
      const opened = await this.current()
      await this.drain(opened, [batch])
      if (!this.options.requestRun || this.invocation) this.pulse(opened)
      else await this.options.requestRun(batch.requestId)
    })
    this.admission = submit.catch(() => {})
    await submit
    return { admitted: envelopes.map((e) => e.id) }
  }

  async stop(): Promise<{ discarded: number }> {
    const opened = await this.opened
    if (!opened) return { discarded: 0 }
    const discarded = (await opened.harness.inspect(context)).submissions.filter((s) => s.status === "queued").length
    await this.workers.stopAll()
    await opened.root.abort(context)
    await this.refreshRecovery(opened)
    return { discarded }
  }

  loaded(): boolean { return this.opened !== undefined }
  async busy(): Promise<boolean> {
    if (!this.opened) return false
    const live = await (await this.opened).harness.inspect(context)
    return live.tasks.length > 0 || live.submissions.length > 0
  }
  async unload(): Promise<void> {
    if (await this.busy()) return
    await this.drop()
  }
  async invalidate(): Promise<void> {
    if (await this.busy()) {
      this.invalidated = true
      return
    }
    await this.drop()
    this.invalidated = false
  }

  async envelopeIds(requestId: string): Promise<string[]> {
    const { root, storage } = await this.open()
    const submission = await storage.submissionByRequest(root.id, requestId, context)
    if (!submission || submission.type !== "input") return []
    const data = submission.entry === undefined ? undefined : (await storage.entry(submission.entry, context))?.entry.data
    if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.envelopeIds)) return []
    return data.envelopeIds.filter((id): id is string => typeof id === "string")
  }

  async wake(): Promise<boolean> {
    const pending = await this.ctx.storage.get<boolean>(STOP_KEY) || (!this.opened && await this.unfinished())
    if (!pending) {
      if (!this.opened) return false
      const live = await (await this.opened).harness.inspect(context)
      return live.tasks.length > 0 || live.submissions.length > 0
    }
    await this.alarms.setWakeup(INBOX_WAKEUP, Math.max(Date.now(), this.humanComingUntil()))
    return true
  }

  private async unfinished(): Promise<boolean> {
    const storage = await JournalStorage.open(this.ctx.storage, "agent")
    try {
      for (const status of ["pending", "running", "waiting", "completing"] as const) {
        if ((await storage.scanTasks({ status }, 1, undefined, context)).items.length) {
          return true
        }
      }
      for (const status of ["queued", "placed"] as const) {
        if ((await storage.scanSubmissions({ status }, 1, undefined, context)).items.length) {
          return true
        }
      }
      return false
    } finally {
      await storage.close(context)
    }
  }

  /** Run RPC boundary. Planned continuations retain setup and replay the existing pi submission. */
  async runInvocation(due: () => boolean): Promise<"done" | "continue"> {
    if (this.invocation) throw new Error("An agent invocation is already running")
    // A warm idle Harness already enabled scheduling. Reopen it paused so the guard precedes progress.
    if (this.opened) {
      this.plannedSetup = (await this.opened).setup
      await this.drop()
    }
    const invocation: NonNullable<AgentHost["invocation"]> = { due }
    this.invocation = invocation
    try {
      await this.alarm()
      const opened = await this.opened
      const boundary = invocation.boundary
      if (!boundary) return "done"
      const outcome = await Promise.race([
        boundary.closed.then(() => "continue" as const),
        opened ? opened.harness.waitForIdle(context).then(() => "done" as const, (error: unknown) => {
          if (!boundary.continuing()) throw error
          return "continue" as const
        }) : Promise.resolve(boundary.continuing() ? "continue" as const : "done" as const),
      ])
      if (outcome === "continue") {
        await boundary.closed
        this.resumed = false
        await this.ctx.storage.delete(RESUMES_KEY)
      }
      return outcome
    } finally {
      invocation.boundary?.dispose()
      this.invocation = undefined
    }
  }

  async alarm(): Promise<void> {
    let batches: Batch[] = []
    let opened: Opened | undefined
    let draining = false
    try {
      await this.failure
      while (this.compaction) await this.compaction
      this.draining++
      draining = true
      await this.serializeAlarm(async () => { await this.alarms.dueWakeups(Date.now()) })
      if (!batches.length && !this.opened && !(await this.ctx.storage.get<boolean>(STOP_KEY)) && !(await this.unfinished())) return
      opened = await this.current()
      await this.drain(opened, batches)
      await this.refreshRecovery(opened)
      this.pulse(opened)
    } catch (error) {
      if (this.invocation?.boundary?.continuing()) return
      await this.fail(error, batches, opened)
    } finally {
      if (draining) this.draining--
    }
  }

  private fail(error: unknown, batches: readonly Batch[], opened?: Opened): Promise<void> {
    if (this.failure) return this.failure
    const work = (async () => {
      console.error("agent alarm failed")
      if (opened) this.retiring.add(opened)
      const stopped = await this.ctx.storage.get<boolean>(STOP_KEY)
      const requestId = batches[0]?.requestId ?? `epoch:${this.epoch()}`
      // The failure consumed the stop it was handling, the same way `drain` does. A stop that arrives later sets the
      // marker again after this delete, so it survives.
      if (stopped) await this.ctx.storage.delete([STOP_KEY, RESTARTS_KEY])
      await this.alarms.clearWakeup(INBOX_WAKEUP)
      try {
        await this.options.onError?.(error, requestId)
      } finally {
        try {
          await this.workers.stopAll()
          if (opened) await opened.root.abort(context, { background: true })
        } finally {
          await this.drop()
        }
      }
    })()
    this.failure = work
    void work.finally(() => { if (this.failure === work) this.failure = undefined }).catch(() => {})
    return work
  }

  open(): Promise<Opened> {
    if (this.opened) return this.opened
    const opening = (async () => {
      const planned = this.plannedSetup
      this.plannedSetup = undefined
      const setup = planned ?? await this.options.setup()
      let opened = await this.openHarness(setup)
      try {
        if (!planned && await this.crashLooping(opened)) {
          await opened.harness.close(context).catch(() => {})
          this.reset()
          opened = await this.openHarness(setup)
          await this.options.onGiveUp?.()
        }
        await this.options.onOpen?.(opened)
        if (!this.options.requestRun || this.invocation) {
          await this.refreshRecovery(opened)
          opened.harness.resume()
          this.workers.rearm(opened.harness)
          if (!planned) await this.workers.resumed(opened.harness)
        }
        return opened
      } catch (error) {
        if (this.invocation?.boundary?.continuing()) throw error
        try {
          await opened.root.abort(context, { background: true })
        } finally {
          await opened.harness.close(context)
        }
        throw error
      }
    })()
    opening.catch(() => {
      if (this.opened === opening) this.opened = undefined
    })
    this.opened = opening
    return opening
  }

  private async current(): Promise<Opened> {
    const opened = await this.open()
    if (!this.invalidated && (!opened.setup.stale || !(await opened.setup.stale()))) return opened
    const live = await opened.harness.inspect(context)
    // Work is already running: it keeps the harness it started on, and this flag makes the next idle open reload.
    if (live.tasks.length || live.submissions.length) return opened
    await this.drop()
    this.invalidated = false
    return this.open()
  }

  private async openHarness(setup: AgentSetup): Promise<Opened> {
    const storage = await JournalStorage.open(this.ctx.storage, "agent")
    const env = setup.env
    const harness = this.options.openHarness ? await this.options.openHarness(storage, setup) : await Harness.open(storage, { models: setup.models, registry: setup.registry, settings: setup.settings, ...(env ? { env: (target) => env(target.conversationId) } : {}) }, context)
    void harness.closed.then((end) => {
      if (end.reason === "failed") this.ctx.abort("Harness failed")
    })
    const root = await harness.root(context, { agent: setup.agent })
    // `root` keeps the agent it was first made with. An integration added later (a browser key) changes the extensions, so write them again.
    const extensions = setup.agent.extensions
    if (Array.isArray(extensions)) {
      const names = extensions.map((e) => e.name)
      if (JSON.stringify(names) !== JSON.stringify(await this.ctx.storage.get(EXTENSIONS_KEY))) {
        await root.configure({ extensions }, context)
        await this.ctx.storage.put(EXTENSIONS_KEY, names)
      }
    }
    const opened = { harness, root, storage, setup }
    this.taskWatches.set(harness, new Map())
    harness.subscribeCommits((publication) => {
      if ((!this.options.requestRun || this.invocation) && publication.changes.some((change) => change.type === "task")) {
        this.options.waitUntil(this.refreshRecovery(opened).catch((error) => {
          if (!this.retiring.has(opened)) return this.fail(error, [], opened)
        }))
      }
    })
    if (this.invocation) {
      const boundary = await continueAtBoundary(harness, this.invocation.due)
      this.invocation.boundary = boundary
      harness.subscribeClose(() => {
        if (!boundary.continuing()) return
        this.retiring.add(opened)
        this.plannedSetup = setup
        this.opened = undefined
      })
    }
    return opened
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

  private serializeAlarm(operation: () => Promise<void>): Promise<void> {
    const update = this.alarmUpdate.then(operation, operation)
    this.alarmUpdate = update
    return update
  }


  private refreshRecovery(opened: Opened): Promise<void> {
    return this.serializeAlarm(async () => {
      if (this.retiring.has(opened)) return
      const { harness } = opened
      const { tasks } = await harness.inspect(context)
      if (this.retiring.has(opened)) return
      const current = this.alarms.deadline(RECOVERY_WAKEUP)
      const watches = this.taskWatches.get(harness)!
      const { next, resume } = this.options.projectTasks(tasks, watches, current)
      if (this.options.recoveryDeadline) await this.options.recoveryDeadline(next)
      else if (next === undefined) await this.alarms.clearWakeup(RECOVERY_WAKEUP)
      else await this.alarms.setWakeup(RECOVERY_WAKEUP, next)
      // waitForTask enables scheduling, so the recovery alarm must be durable first.
      for (const { id, deadline } of resume) {
        const watching = watches.has(id)
        watches.set(id, deadline)
        if (watching) continue
        this.options.waitUntil(harness.waitForTask(id, context)
          .then(() => this.refreshRecovery(opened))
          .catch((error) => {
            if (!this.retiring.has(opened)) return this.fail(error, [], opened)
          })
          .finally(() => watches.delete(id)))
      }
    })
  }

  private async idle(): Promise<void> {
    if (this.resumed) {
      this.resumed = false
      await this.ctx.storage.delete(RESUMES_KEY)
    }
    await (this.compaction ??= this.compact().finally(() => { this.compaction = undefined }))
  }

  private async compact(): Promise<void> {
    if (this.draining) return
    const size = this.ctx.storage.sql.exec<{ rows: number; bytes: number }>(
      "SELECT count(*) AS rows, coalesce(sum(length(data)), 0) AS bytes FROM journal WHERE agent = ?", "agent",
    ).one()
    if (size.rows <= 500 && size.bytes <= 4 * 1024 * 1024) return
    const opened = await this.open()
    const live = await opened.harness.inspect(context)
    if (this.draining || live.tasks.length || live.submissions.length || this.retiring.has(opened)) return
    await opened.setup.beforeCompact?.(opened.harness)
    await this.drop()
    this.reset()
  }

  async status(): Promise<HostStatus> {
    const inbox = { waiting: 0, claimed: 0, submitted: 0 }
    if (!this.opened) return { open: false, inbox, tasks: 0, submissions: 0 }
    const { harness } = await this.opened
    const live = await harness.inspect(context)
    return { open: true, inbox, tasks: live.tasks.length, submissions: live.submissions.length }
  }

  private async drain({ harness, root, storage, setup }: Opened, batches: readonly Batch[]): Promise<void> {
    const { beginRun, joinRun, inputContext, inputMemory } = setup
    if (await this.ctx.storage.get<boolean>(STOP_KEY)) {
      await this.workers.stopAll()
      await root.abort(context)
      await this.ctx.storage.delete([STOP_KEY, RESTARTS_KEY])
    }
    for (const batch of batches) {
      if (await storage.submissionByRequest(root.id, batch.requestId, context)) {
        continue
      }
      const human = batch.envelopes.some((e) => e.from.kind === "human")
      let run = await this.runState(harness, root)
      if (human) await this.alarms.clearWakeup(HUMAN_COMING)
      const invalidated = (await setup.inputInvalidated?.()) ?? null
      if (invalidated) {
        await root.abort(context)
        if (invalidated === "forget") await this.workers.invalidate(harness)
        run = null
      }
      batch.envelopes = batch.envelopes.filter((envelope) => !envelope.work || this.workers.get(envelope.work.id)?.conversationId != null)
      if (!batch.envelopes.length) {
        continue
      }
      if (!run && beginRun && !(await beginRun(batch, root))) {
        continue
      }
      if (run) await joinRun?.(batch, root)
      const whenBusy = human ? "steer" as const : "followUp" as const
      let memory: string | undefined
      let fresh = false
      if (!run && inputMemory) {
        const out = await inputMemory(batch, invalidated !== null || await this.contextFull(root), await this.joinedSeqs())
        fresh = out.fresh
        if (out.fresh) {
          if (this.options.requestRun && !this.invocation) await root.commit((tx) => tx.appendEntry(root.id, { kind: "pi.reset", head: "self" }), context)
          else await root.reset(undefined, context)
        }
        await this.ctx.storage.put(LAST_RUN_KEY, Date.now())
        await this.ctx.storage.delete(JOINED_KEY)
        memory = out.text
      }
      this.inputs++
      const [extra, last] = await Promise.all([inputContext?.(), this.ctx.storage.get<{ epoch: number; key: string }>(BRIEF_KEY)])
      const shown = briefToShow(batch.briefs, fresh, last?.epoch === this.epoch() ? last.key : undefined, this.options.shortBrief)
      const work = this.workers.note()
      const content = renderInput({ ...batch, briefs: [...(shown.brief ? [shown.brief] : []), ...(extra ? [extra] : []), ...(work ? [work] : [])] }, memory)
      const submission = { type: "input" as const, content, requestId: batch.requestId, whenBusy,
        entry: { kind: "kiko.input", data: { envelopeIds: batch.envelopes.map((e) => e.id), chain: batch.envelopes.map(({ rootId, hop }) => ({ rootId, hop })) } },
      }
      if (this.options.requestRun && !this.invocation) await submitPaused(root, submission)
      else await root.submit(submission, context)
      if (!this.options.requestRun || this.invocation) await this.refreshRecovery({ harness, root, storage, setup })
      if (shown.key && (last?.epoch !== this.epoch() || last.key !== shown.key)) await this.ctx.storage.put(BRIEF_KEY, { epoch: this.epoch(), key: shown.key })
      if (run) await this.ctx.storage.put(JOINED_KEY, [...(await this.joinedSeqs()), ...batch.envelopes.map((e) => e.seq)].slice(-500))
    }
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
    if (!mine.some((s) => s.status === "placed") && !live.tasks.some((t) => t.record.conversationId === root.id && !t.record.background)) return null
    return {
      ...(this.options.progress?.() ?? FRESH_RUN),
      queued: mine.some((s) => s.status === "queued"),
      restarts: (await this.ctx.storage.get<number>(RESTARTS_KEY)) ?? 0,
    }
  }

  humanComing(): void {
    this.options.waitUntil(this.alarms.setWakeup(HUMAN_COMING, Date.now() + HUMAN_COMING_MS))
  }

  async humanGone(): Promise<void> {
    if (this.alarms.deadline(HUMAN_COMING) === undefined) return
    await this.alarms.clearWakeup(HUMAN_COMING)
  }

  async rootId(): Promise<ConversationId | null> {
    return this.opened ? (await this.opened).root.id : null
  }

  epoch(): number {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM harness_epoch WHERE id = 1").toArray()[0]?.n ?? 0
  }

  humanWaiting(): boolean {
    return this.humanComingUntil() > Date.now()
  }

  private humanComingUntil(): number {
    return this.alarms.deadline(HUMAN_COMING) ?? 0
  }

  private pulse(opened: Opened): void {
    const { harness } = opened
    // A background worker can outlive the root. Its work belongs to this invocation too.
    this.options.waitUntil((async () => {
      await harness.waitForIdle(context)
      await this.idle()
      this.options.onIdle?.()
    })().catch((error) => {
      if (!this.retiring.has(opened)) return this.fail(error, [], opened)
    }))
  }

  private reset(): void {
    JournalStorage.clear(this.ctx.storage, "agent")
    this.ctx.storage.sql.exec("INSERT INTO harness_epoch (id, n) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET n = n + 1")
    this.workers.forget()
    this.options.onReset?.()
  }

  async shutdown(): Promise<void> {
    const opened = await this.opened?.catch(() => undefined)
    this.opened = undefined
    if (!opened) return
    this.retiring.add(opened)
    await opened.root.abort(context, { background: true }).catch(() => {})
    await opened.harness.close(context).catch(() => {})
    await this.serializeAlarm(() => this.options.recoveryDeadline ? this.options.recoveryDeadline(undefined) : this.alarms.clearWakeup(RECOVERY_WAKEUP))
  }

  private async drop(): Promise<void> {
    const opened = this.opened
    this.opened = undefined
    if (!opened) return
    await opened.then((o) => { this.retiring.add(o); return o.harness.close(context) }).catch(() => {})
    await this.serializeAlarm(() => this.options.recoveryDeadline ? this.options.recoveryDeadline(undefined) : this.alarms.clearWakeup(RECOVERY_WAKEUP))
  }
}

