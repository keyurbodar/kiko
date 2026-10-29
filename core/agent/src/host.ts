import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { JsonValue } from "@earendil-works/chord"
import type { Models } from "@earendil-works/pi-ai"
import {
  type AgentChange,
  type Conversation,
  type ConversationId,
  Harness,
  type HarnessSettings,
  type Storage,
  type RegistryReader,
  type TaskId,
  type TaskInspection,
} from "@earendil-works/pi-durable"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import type { Step } from "@kiko/durable/migrate"
import { JournalStorage } from "./journal"
import { continueAtBoundary } from "./continuation"
import { submitPaused } from "./admission"
import { InvocationBusy, JournalCorrupt } from "./errors"
import { type Batch, type Refusal, renderInput, requestIdFor } from "./input"
import {
  cancelPaused,
  cancelRestart,
  rootGeneration,
  recoverRestart,
  rememberRestart,
  replayQueued,
  takeQueued,
  type RestartInput,
} from "./human-priority"
import type { Envelope } from "./envelope"
import { ROLLOVER_STEPS, restoreRollover, rollover } from "./rollover"
import { INITIAL_WORKERS_STEPS, Workers } from "./workers"

const context = BACKGROUND_CONTEXT

export const INBOX_WAKEUP = "inbox"
const CONTEXT_BUDGET_CHARS = 60_000
const TASK_BUDGET_CHARS = 240_000
const TASK_IDLE_MS = 15 * 60_000

export type Transcript = { inputs: number; chars: number; toolChars: number; idleMs: number }

type ModelMessage = {
  role?: string
  content?: string | { type: string; text?: string; thinking?: string; arguments?: unknown }[]
}

export function measure(entries: readonly { kind: string; model?: readonly unknown[] }[], idleMs: number): Transcript {
  const t: Transcript = { inputs: 0, chars: 0, toolChars: 0, idleMs }
  for (const entry of entries) {
    const first = (entry.kind === "pi.user" || entry.kind === "kiko.input") && t.inputs === 0
    if (entry.kind === "pi.user" || entry.kind === "kiko.input") t.inputs++
    for (const m of (entry.model ?? []) as ModelMessage[]) {
      const n = messageChars(m, first)
      t.chars += n
      if (m.role === "toolResult") t.toolChars += n
    }
  }
  return t
}

function messageChars(m: ModelMessage, first: boolean): number {
  let n = 0
  if (typeof m.content === "string") n = m.content.length - (first ? opening(m.content) : 0)
  else
    for (const p of m.content ?? [])
      n +=
        (p.text?.length ?? 0) -
        (first ? opening(p.text ?? "") : 0) +
        (p.thinking?.length ?? 0) +
        (p.arguments ? JSON.stringify(p.arguments).length : 0)
  return n
}

function deliveredSeq(envelopes: Batch["envelopes"], initial: number): number {
  let humanDeliveredSeq = initial
  for (const envelope of envelopes) {
    if (envelope.from.kind !== "human") continue
    const match = /^human:([1-9][0-9]*)\.[0-9a-f]+(?:#.*)?$/.exec(envelope.id)
    const seq = match ? Number(match[1]) : 0
    if (Number.isSafeInteger(seq)) humanDeliveredSeq = Math.max(humanDeliveredSeq, seq)
  }
  return humanDeliveredSeq
}

function opening(text: string): number {
  if (!text.startsWith("<memory>")) return 0
  const end = text.indexOf("</memory>")
  return end < 0 ? 0 : end + "</memory>".length
}

function briefToShow(
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

function startsFresh(t: Transcript): boolean {
  if (t.inputs === 0) return true
  if (t.chars <= CONTEXT_BUDGET_CHARS) return false
  const working = t.toolChars * 2 > t.chars && t.idleMs < TASK_IDLE_MS
  return !working || t.chars > TASK_BUDGET_CHARS
}
const LAST_RUN_KEY = "runs:last-at"
const STOP_KEY = "mid-run:stop"
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
  inputContext?: (midRun: boolean) => Promise<string | undefined>
  inputInvalidated?: () => Promise<"refresh" | "forget" | null>
  inputMemory?: (
    batch: Batch,
    fresh: boolean,
    joined: number[],
  ) => Promise<{ text?: string; fresh: boolean; data?: Record<string, JsonValue> }>
  joinMemory?: (batch: Batch, joined: number[]) => Promise<{ text?: string; data?: Record<string, JsonValue> }>
  beforeCompact?: (harness: Harness) => Promise<void>
  stale?: () => Promise<boolean>
  rollover?: {
    capture(tasks: readonly TaskInspection["record"][]): readonly JsonValue[] | null
    restore(harness: Harness, root: Conversation, input: readonly JsonValue[]): Promise<void>
  }
}

export type HostOptions = {
  requestRun: (requestId: string) => void | Promise<void>
  agentKey: string
  clock: Alarms
  projectTasks: (
    tasks: readonly TaskInspection[],
    watches: ReadonlyMap<TaskId, number>,
    current: number | undefined,
  ) => { next: number | undefined; resume: { id: TaskId; deadline: number }[] }
  openHarness?: (storage: Storage, setup: AgentSetup) => Promise<Harness>
  setup: () => AgentSetup | Promise<AgentSetup>
  onOpen?: (opened: Opened) => void | Promise<void>
  onGiveUp?: () => void | Promise<void>
  scheduledDeadline?: (task: Pick<TaskInspection, "record">) => number | undefined
  beforeIdle?: (opened: Opened) => Promise<void>
  onIdle?: () => void | Promise<void>
  shortBrief?: (brief: string) => string
  onReset?: () => void
  onError?: (error: unknown, requestId: string) => void | Promise<void>
  onWorkers?: (running: number, pending: boolean) => void
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
  tasks: number
  submissions: number
}

const HUMAN_COMING = "human-coming"
const HUMAN_COMING_MS = 10_000

const RECOVERY_WAKEUP = "recovery"

const MAX_RESUMES = 3
const RESUMES_KEY = "crash:resumes"
const EXTENSIONS_KEY = "agent:extensions"

export const INITIAL_HOST_STEPS: Step[] = [
  ...INITIAL_WORKERS_STEPS,
  ...ROLLOVER_STEPS,
  "CREATE TABLE IF NOT EXISTS harness_epoch (agent TEXT PRIMARY KEY, n INTEGER NOT NULL) WITHOUT ROWID, STRICT",
]

export class AgentHost {
  readonly workers: Workers
  private readonly alarms: Alarms
  private opened?: Promise<Opened>
  private plannedSetup?: AgentSetup
  private invocation?: {
    due: () => boolean
    boundary?: Awaited<ReturnType<typeof continueAtBoundary>>
    idle?: Promise<void>
    settling?: boolean
  }
  private failure?: Promise<void>
  private compaction?: Promise<void>
  private draining = 0
  private readonly retiring = new WeakSet<Opened>()
  private resumed = false
  private endedByStop = false
  private alarmUpdate: Promise<void> = Promise.resolve()
  private readonly taskWatches = new WeakMap<Harness, Map<TaskId, number>>()

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly options: HostOptions,
  ) {
    this.workers = new Workers(ctx.storage, {
      agentKey: options.agentKey,
      deliver: (envelope) => this.receive([envelope], ""),
      onChange: (running) => options.onWorkers?.(running, false),
    })
    this.alarms = options.clock
  }

  private invalidated = false
  private admission: Promise<unknown> = Promise.resolve()

  async receive(
    envelopes: readonly Envelope[],
    brief: string,
    requestId?: string,
  ): Promise<{ admitted: string[]; refused?: Refusal }> {
    if (envelopes.some((e) => new TextEncoder().encode(JSON.stringify(e) + brief).byteLength > 128 * 1024))
      return { admitted: [], refused: "too_large" }
    const batch: Batch = {
      requestId:
        requestId ??
        (envelopes.length === 1 && envelopes[0]?.from.kind !== "human"
          ? envelopes[0]!.id
          : await requestIdFor(envelopes.map((e) => e.id))),
      envelopes: [...envelopes],
      briefs: brief ? [brief] : [],
    }
    const submit = this.admission.then(async () => {
      const opened = await this.current()
      const admitted = await this.drain(opened, [batch])
      if (envelopes.some((envelope) => envelope.from.kind !== "human")) opened.storage.flush()
      if (!admitted) return
      if (this.invocation && !this.invocation.settling) this.pulse(opened)
      else await this.options.requestRun(batch.requestId)
    })
    this.admission = submit.catch(() => {})
    await submit
    return { admitted: envelopes.map((e) => e.id) }
  }

  async stop(): Promise<{ discarded: number }> {
    const work = this.admission.then(() => this.stopNow())
    this.admission = work.catch(() => {})
    return work
  }

  private async stopNow(): Promise<{ discarded: number }> {
    await this.ctx.storage.put(STOP_KEY, true)
    let opened = await this.open()
    if (
      (!this.invocation || this.invocation.settling) &&
      (await opened.harness.inspect(context)).scheduling !== "paused"
    ) {
      this.plannedSetup = opened.setup
      await this.drop(true)
      opened = await this.open()
    }
    const discarded = (await opened.harness.inspect(context)).submissions.filter((s) => s.status === "queued").length
    await this.drain(opened, [])
    await this.refreshRecovery(opened)
    return { discarded }
  }

  loaded(): boolean {
    return this.opened !== undefined
  }
  async busy(): Promise<boolean> {
    if (!this.opened) return false
    const live = await (await this.opened).harness.inspect(context)
    return live.tasks.some((task) => !this.futureTask(task)) || live.submissions.length > 0
  }
  private futureTask(task: Pick<TaskInspection, "record">): boolean {
    const at = this.options.scheduledDeadline?.(task)
    return at !== undefined && at > Date.now() && !task.record.abortRequested
  }
  async unload(): Promise<void> {
    if (await this.busy()) return
    await this.drop(true)
  }
  async invalidate(): Promise<void> {
    if (await this.busy()) {
      this.invalidated = true
      return
    }
    await this.drop(true)
    this.invalidated = false
  }

  async envelopeIds(requestId: string): Promise<string[]> {
    const { root, storage } = await this.open()
    const submission = await storage.submissionByRequest(root.id, requestId, context)
    if (!submission || submission.type !== "input") return []
    const data =
      submission.entry === undefined ? undefined : (await storage.entry(submission.entry, context))?.entry.data
    if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.envelopeIds)) return []
    return data.envelopeIds.filter((id): id is string => typeof id === "string")
  }

  async wake(): Promise<boolean> {
    const pending = (await this.ctx.storage.get<boolean>(STOP_KEY)) || (!this.opened && (await this.unfinished()))
    if (!pending) {
      if (!this.opened) return false
      const live = await (await this.opened).harness.inspect(context)
      return live.tasks.length > 0 || live.submissions.length > 0
    }
    await this.alarms.setWakeup(INBOX_WAKEUP, Math.max(Date.now(), this.humanComingUntil()))
    return true
  }

  async unfinished(): Promise<boolean> {
    const storage = await JournalStorage.open(this.ctx.storage, this.options.agentKey)
    try {
      for (const status of ["pending", "running", "waiting", "completing"] as const) {
        let cursor: Parameters<JournalStorage["scanTasks"]>[2]
        do {
          const page = await storage.scanTasks({ status }, 100, cursor, context)
          if (page.items.some((record) => !this.futureTask({ record }))) return true
          cursor = page.next
        } while (cursor)
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

  async runInvocation(due: () => boolean): Promise<"done" | "continue"> {
    if (this.invocation) throw new InvocationBusy({ message: "An agent invocation is already running" })
    if (this.opened) {
      const opened = await this.opened
      if ((await opened.harness.inspect(context)).scheduling !== "paused") {
        this.plannedSetup = opened.setup
        await this.drop(true)
      }
    }
    const invocation: NonNullable<AgentHost["invocation"]> = { due }
    this.invocation = invocation
    this.endedByStop = false
    try {
      if (this.opened) {
        const opened = await this.opened
        await this.attachBoundary(opened)
        this.workers.rearm(opened.harness)
      }
      await this.alarm()
      const opened = await this.opened
      const boundary = invocation.boundary
      if (!boundary) return "done"
      const outcome = await Promise.race([
        boundary.closed.then(() => "continue" as const),
        opened
          ? opened.harness.waitForIdle(context).then(
              () => "done" as const,
              (error: unknown) => {
                if (invocation.settling) return "done" as const
                if (!boundary.continuing()) throw error
                return "continue" as const
              },
            )
          : Promise.resolve(boundary.continuing() ? ("continue" as const) : ("done" as const)),
      ])
      if (outcome === "continue") {
        await boundary.closed
        this.resumed = false
        await this.ctx.storage.delete(RESUMES_KEY)
      }
      if (outcome === "done") while (invocation.idle) await invocation.idle
      return outcome
    } finally {
      invocation.boundary?.dispose()
      this.invocation = undefined
    }
  }

  async alarm(): Promise<void> {
    let opened: Opened | undefined
    let draining = false
    try {
      await this.failure
      while (this.compaction) await this.compaction
      this.draining++
      draining = true
      if (!this.opened && !(await this.ctx.storage.get<boolean>(STOP_KEY)) && !(await this.unfinished())) {
        await this.serializeAlarm(async () => {
          for (const key of await this.alarms.dueWakeups(Date.now())) await this.alarms.clearWakeup(key)
        })
        return
      }
      await this.serializeAlarm(async () => {
        const now = Date.now()
        const due = await this.alarms.dueWakeups(now)
        for (const key of due) if (key !== RECOVERY_WAKEUP) await this.alarms.clearWakeup(key)
      })
      opened = await this.current()
      if (this.invocation && !this.invocation.settling) {
        const current = opened
        const { root, storage } = current
        const recovery = this.admission.then(async () => {
          await this.drain(current, [])
          await recoverRestart(root, storage)
        })
        this.admission = recovery.catch(() => {})
        await recovery
      }
      await this.drain(opened, [])
      await this.refreshRecovery(opened)
      this.pulse(opened)
    } catch (error) {
      if (this.invocation?.boundary?.continuing()) return
      await this.fail(error, opened)
    } finally {
      if (draining) this.draining--
    }
  }

  private fail(error: unknown, opened?: Opened): Promise<void> {
    if (this.failure) return this.failure
    const work = (async () => {
      console.error("agent alarm failed")
      if (opened) this.retiring.add(opened)
      const stopped = await this.ctx.storage.get<boolean>(STOP_KEY)
      const requestId = `epoch:${this.epoch()}`
      if (stopped) await this.ctx.storage.delete(STOP_KEY)
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
    void work
      .finally(() => {
        if (this.failure === work) this.failure = undefined
      })
      .catch(() => {})
    return work
  }

  open(): Promise<Opened> {
    if (this.opened) return this.opened
    const opening = (async () => {
      const planned = this.plannedSetup
      this.plannedSetup = undefined
      const setup = planned ?? (await this.options.setup())
      let opened = await this.openHarness(setup)
      try {
        if (!planned && (await this.crashLooping(opened))) {
          await opened.harness.close(context).catch(() => {})
          this.reset()
          opened = await this.openHarness(setup)
          await this.options.onGiveUp?.()
        }
        await this.options.onOpen?.(opened)
        if (this.invocation && !this.invocation.settling) {
          await this.drain(opened, [])
          await recoverRestart(opened.root, opened.storage)
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
    if (live.tasks.some((task) => !this.futureTask(task)) || live.submissions.length) return opened
    await this.drop(true)
    this.invalidated = false
    return this.open()
  }

  private async openHarness(setup: AgentSetup): Promise<Opened> {
    setup = { ...setup, settings: { ...setup.settings, steeringMode: "all", followUpMode: "all" } }
    const storage = await JournalStorage.open(this.ctx.storage, this.options.agentKey)
    const env = setup.env
    const harness = this.options.openHarness
      ? await this.options.openHarness(storage, setup)
      : await Harness.open(
          storage,
          {
            models: setup.models,
            registry: setup.registry,
            settings: setup.settings,
            ...(env ? { env: (target) => env(target.conversationId) } : {}),
          },
          context,
        )
    void harness.closed.then((end) => {
      if (end.reason === "failed") this.ctx.abort("Harness failed")
    })
    const root = await harness.root(context, { agent: setup.agent })
    const extensions = setup.agent.extensions
    if (Array.isArray(extensions)) {
      const names = extensions.map((e) => e.name)
      if (JSON.stringify(names) !== JSON.stringify(await this.ctx.storage.get(EXTENSIONS_KEY))) {
        await root.configure({ extensions }, context)
        await this.ctx.storage.put(EXTENSIONS_KEY, names)
      }
    }
    try {
      await restoreRollover(this.ctx.storage, this.options.agentKey, async (input) => {
        if (!setup.rollover)
          throw new JournalCorrupt({ reason: "handoff", message: "Agent task handoff has no registered restorer" })
        await setup.rollover.restore(harness, root, input)
      })
    } catch (error) {
      await harness.close(context).catch(() => {})
      throw error
    }
    const opened = { harness, root, storage, setup }
    this.taskWatches.set(harness, new Map())
    harness.subscribeCommits((publication) => {
      if (publication.changes.some((change) => change.type === "task")) {
        this.options.waitUntil(
          this.refreshRecovery(opened).catch((error) => {
            if (!this.retiring.has(opened)) return this.fail(error, opened)
          }),
        )
      }
    })
    await this.attachBoundary(opened)
    return opened
  }

  private async attachBoundary(opened: Opened): Promise<void> {
    const { harness, setup } = opened
    if (this.invocation && !this.invocation.settling) {
      const boundary = await continueAtBoundary(harness, this.invocation.due, (record) => this.futureTask({ record }))
      this.invocation.boundary = boundary
      harness.subscribeClose(() => {
        if (!boundary.continuing()) return
        this.retiring.add(opened)
        this.plannedSetup = setup
        this.opened = undefined
      })
    }
  }

  private async crashLooping({ harness, root }: Opened): Promise<boolean> {
    const live = await harness.inspect(context)
    if (!live.tasks.some((t) => t.record.conversationId === root.id && !t.record.background)) {
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
      if (next === undefined) await this.alarms.clearWakeup(RECOVERY_WAKEUP)
      else await this.alarms.setWakeup(RECOVERY_WAKEUP, next)
      if (!this.invocation || this.invocation.settling) return
      for (const { id, deadline } of resume) {
        const watching = watches.has(id)
        watches.set(id, deadline)
        if (watching) continue
        this.options.waitUntil(
          harness
            .waitForTask(id, context)
            .then(() => this.refreshRecovery(opened))
            .catch((error) => {
              if (!this.retiring.has(opened)) return this.fail(error, opened)
            })
            .finally(() => watches.delete(id)),
        )
      }
    })
  }

  private async idle(): Promise<void> {
    if (this.resumed) {
      this.resumed = false
      await this.ctx.storage.delete(RESUMES_KEY)
    }
    await (this.compaction ??= this.compact().finally(() => {
      this.compaction = undefined
    }))
  }

  private compact(): Promise<void> {
    const work = this.admission.then(() => this.compactNow())
    this.admission = work.catch(() => {})
    return work
  }

  private async compactNow(): Promise<void> {
    if (this.draining) return
    const size = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        "SELECT count(*) AS rows, coalesce(sum(length(data)), 0) AS bytes FROM journal WHERE agent = ?",
        this.options.agentKey,
      )
      .one()
    if (size.rows <= 500 && size.bytes <= 4 * 1024 * 1024) return
    const opened = await this.open()
    const live = await opened.harness.inspect(context)
    if (this.draining || live.submissions.length || this.retiring.has(opened)) return
    if (live.tasks.length && !opened.setup.rollover?.capture(live.tasks.map((task) => task.record))) return
    await opened.setup.beforeCompact?.(opened.harness)
    await this.drop(true)
    const storage = JournalStorage.open(this.ctx.storage, this.options.agentKey)
    try {
      for (const status of ["queued", "placed"] as const) {
        if ((await storage.scanSubmissions({ status }, 1, undefined, context)).items.length) return
      }
      const tasks: TaskInspection["record"][] = []
      let cursor: Awaited<ReturnType<JournalStorage["scanTasks"]>>["next"]
      do {
        const page = await storage.scanTasks({}, 100, cursor, context)
        tasks.push(...page.items.filter((task) => task.state.status !== "terminal"))
        cursor = page.next
      } while (cursor)
      const input = tasks.length ? opened.setup.rollover?.capture(tasks) : []
      if (input === null || input === undefined) return
      if (tasks.length) rollover(this.ctx.storage, this.options.agentKey, input, () => this.reset())
      else this.ctx.storage.transactionSync(() => this.reset())
    } finally {
      await storage.close(context)
    }
  }

  async updateTasks(update: (opened: Opened) => Promise<void>): Promise<void> {
    const work = this.admission.then(async () => {
      const opened = await this.current()
      await update(opened)
      await this.refreshRecovery(opened)
    })
    this.admission = work.catch(() => {})
    await work
  }

  async status(): Promise<HostStatus> {
    if (!this.opened) return { open: false, tasks: 0, submissions: 0 }
    const { harness } = await this.opened
    const live = await harness.inspect(context)
    return { open: true, tasks: live.tasks.length, submissions: live.submissions.length }
  }

  private async drain(opened: Opened, batches: readonly Batch[]): Promise<boolean> {
    if (await this.ctx.storage.get<boolean>(STOP_KEY)) {
      this.endedByStop = true
      await cancelRestart(opened.root, opened.storage)
      const live = await opened.harness.inspect(context)
      const paused = live.scheduling === "paused"
      await this.workers.stopAll({ deferAbort: paused })
      const kept = await takeQueued(opened.root, live)
      if (paused)
        await cancelPaused(opened.harness, opened.root, {
          ...live,
          tasks: live.tasks.filter((task) => this.options.scheduledDeadline?.(task) === undefined),
        })
      else await opened.root.abort(context)
      opened.storage.flush()
      await this.ctx.storage.delete(STOP_KEY)
      if (kept.length) await replayQueued(opened.root, kept, `stop:${this.epoch()}:${Date.now()}`)
    }
    let admitted = false
    for (const batch of batches) if (await this.drainBatch(opened, batch)) admitted = true
    return admitted
  }

  private async drainBatch(opened: Opened, batch: Batch): Promise<boolean> {
    const { harness, root, storage, setup } = opened
    const existing = await storage.submissionByRequest(root.id, batch.requestId, context)
    if (existing) return existing.status === "queued" || existing.status === "placed"
    const human = batch.envelopes.some((e) => e.from.kind === "human")
    let run = await this.runState(harness, root)
    if (human) await this.alarms.clearWakeup(HUMAN_COMING)
    const invalidated = (await setup.inputInvalidated?.()) ?? null
    if (invalidated) {
      await root.abort(context)
      if (invalidated === "forget") await this.workers.invalidate(harness)
      run = false
    }
    batch.envelopes = batch.envelopes.filter(
      (envelope) =>
        (!envelope.work || this.workers.get(envelope.work.id)?.conversationId != null) &&
        (envelope.from.kind !== "human" || envelope.seq > storage.humanDeliveredSeq),
    )
    if (!batch.envelopes.length) return false
    if (!run && setup.beginRun && !(await setup.beginRun(batch, root))) return false
    if (run) await setup.joinRun?.(batch, root)
    const { input, shown, last } = await this.prepareInput(opened, batch, run, invalidated !== null)
    await this.admitInput(opened, input, run, human)
    await this.refreshRecovery(opened)
    if (shown.key && (last?.epoch !== this.epoch() || last.key !== shown.key))
      await this.ctx.storage.put(BRIEF_KEY, { epoch: this.epoch(), key: shown.key })
    if (run)
      await this.ctx.storage.put(
        JOINED_KEY,
        [...(await this.joinedSeqs()), ...batch.envelopes.map((e) => e.seq)].slice(-500),
      )
    return true
  }

  private async prepareInput({ root, storage, setup }: Opened, batch: Batch, run: boolean, invalidated: boolean) {
    let memory: string | undefined
    let fresh = false
    let inputData: Record<string, JsonValue> = {}
    if (!run && setup.inputMemory) {
      const out = await setup.inputMemory(batch, invalidated || (await this.contextFull(root)), await this.joinedSeqs())
      fresh = out.fresh
      inputData = out.data ?? {}
      if (out.fresh) {
        if (!this.invocation || this.invocation.settling)
          await root.commit((tx) => tx.appendEntry(root.id, { kind: "pi.reset", head: "self" }), context)
        else await root.reset(undefined, context)
      }
      await this.ctx.storage.delete(JOINED_KEY)
      memory = out.text
    } else if (run && setup.joinMemory) {
      const out = await setup.joinMemory(batch, await this.joinedSeqs())
      inputData = out.data ?? {}
      memory = out.text
    }
    const [extra, last] = await Promise.all([
      setup.inputContext?.(run),
      this.ctx.storage.get<{ epoch: number; key: string }>(BRIEF_KEY),
    ])
    const shown = briefToShow(
      batch.briefs,
      fresh,
      last?.epoch === this.epoch() ? last.key : undefined,
      this.options.shortBrief,
    )
    const work = this.workers.note()
    const content = renderInput(
      { ...batch, briefs: [...(shown.brief ? [shown.brief] : []), ...(extra ? [extra] : []), ...(work ? [work] : [])] },
      memory,
    )
    const input: RestartInput = {
      content,
      requestId: batch.requestId,
      entry: {
        kind: "kiko.input",
        data: {
          ...inputData,
          humanDeliveredSeq: deliveredSeq(batch.envelopes, storage.humanDeliveredSeq),
          at: Date.now(),
          envelopeIds: batch.envelopes.map((e) => e.id),
          chain: batch.envelopes.map(({ rootId, hop }) => ({ rootId, hop })),
        },
      },
    }
    return { input, shown, last }
  }

  private async admitInput(
    { harness, root, storage }: Opened,
    input: RestartInput,
    run: boolean,
    human: boolean,
  ): Promise<void> {
    const generation = run ? await rootGeneration(harness, root) : undefined
    if (generation?.abortRequested) {
      await rememberRestart(root, storage, input)
      if (this.invocation && !this.invocation.settling) await recoverRestart(root, storage)
      return
    }
    const submission = {
      type: "input" as const,
      ...input,
      whenBusy: human ? ("steer" as const) : ("followUp" as const),
    }
    if (!this.invocation || this.invocation.settling) await submitPaused(root, submission)
    else await root.submit(submission, context)
  }

  private async contextFull(root: Conversation): Promise<boolean> {
    const view = await root.context(context)
    const data = view.entries.findLast((entry) => entry.kind === "kiko.input")?.data
    const at =
      data && typeof data === "object" && !Array.isArray(data) && typeof data.at === "number"
        ? data.at
        : ((await this.ctx.storage.get<number>(LAST_RUN_KEY)) ?? 0)
    return startsFresh(measure(view.entries, Date.now() - at))
  }

  async joinedSeqs(): Promise<number[]> {
    return (await this.ctx.storage.get<number[]>(JOINED_KEY)) ?? []
  }

  private async runState(harness: Harness, root: Conversation): Promise<boolean> {
    const live = await harness.inspect(context)
    const mine = live.submissions.filter((s) => s.conversationId === root.id)
    return (
      mine.some((s) => s.status === "placed") ||
      live.tasks.some((t) => t.record.conversationId === root.id && !t.record.background)
    )
  }

  humanComing(): void {
    this.options.waitUntil(this.alarms.setWakeup(HUMAN_COMING, Date.now() + HUMAN_COMING_MS))
  }

  async humanGone(): Promise<void> {
    if (this.alarms.deadline(HUMAN_COMING) === undefined) return
    await this.alarms.clearWakeup(HUMAN_COMING)
  }

  async inputData(field?: string): Promise<Record<string, JsonValue> | undefined> {
    if (!this.opened) return undefined
    const { root } = await this.opened
    const view = await root.context(context)
    const data = view.entries.findLast(
      (entry) =>
        entry.kind === "kiko.input" &&
        entry.data &&
        typeof entry.data === "object" &&
        !Array.isArray(entry.data) &&
        (field === undefined || field in entry.data),
    )?.data
    return data && typeof data === "object" && !Array.isArray(data) ? data : undefined
  }

  async rootId(): Promise<ConversationId | null> {
    return this.opened ? (await this.opened).root.id : null
  }

  epoch(): number {
    return (
      this.ctx.storage.sql
        .exec<{ n: number }>("SELECT n FROM harness_epoch WHERE agent = ?", this.options.agentKey)
        .toArray()[0]?.n ?? 0
    )
  }

  humanWaiting(): boolean {
    return this.humanComingUntil() > Date.now()
  }

  private humanComingUntil(): number {
    return this.alarms.deadline(HUMAN_COMING) ?? 0
  }

  private pulse(opened: Opened): void {
    const invocation = this.invocation
    if (!invocation || invocation.idle || invocation.settling) return
    let revision = 0
    let changed = Promise.withResolvers<void>()
    const notify = () => {
      revision++
      changed.resolve()
      changed = Promise.withResolvers<void>()
    }
    const uncommit = opened.harness.subscribeCommits(notify)
    const unclose = opened.harness.subscribeClose(notify)
    const work = (async () => {
      for (;;) {
        const observed = revision
        await opened.harness.waitForIdle(context)
        opened.storage.flush()
        await this.options.beforeIdle?.(opened)
        const settle = this.admission.then(async () => {
          const live = await opened.harness.inspect(context)
          if (live.submissions.length || live.tasks.some((task) => !this.futureTask(task))) return false
          invocation.settling = true
          this.plannedSetup = opened.setup
          await this.drop(true)
          return true
        })
        this.admission = settle.catch(() => {})
        if (!(await settle)) {
          if (revision === observed) await changed.promise
          continue
        }
        await this.idle()
        if (!this.endedByStop) await this.options.onIdle?.()
        return
      }
    })()
      .catch((error) => {
        if (!this.retiring.has(opened)) return this.fail(error, opened)
      })
      .finally(() => {
        uncommit()
        unclose()
        if (invocation.idle === work) invocation.idle = undefined
      })
    invocation.idle = work
    this.options.waitUntil(work)
  }

  private reset(): void {
    JournalStorage.reset(this.ctx.storage, this.options.agentKey)
    this.ctx.storage.sql.exec(
      "INSERT INTO harness_epoch (agent, n) VALUES (?, 1) ON CONFLICT(agent) DO UPDATE SET n = n + 1",
      this.options.agentKey,
    )
    this.workers.forget()
    this.options.onReset?.()
  }

  async shutdown(): Promise<void> {
    const opened = await this.opened?.catch(() => undefined)
    this.opened = undefined
    if (!opened) return
    this.retiring.add(opened)
    if (this.invocation && !this.invocation.settling)
      await opened.root.abort(context, { background: true }).catch(() => {})
    await opened.harness.close(context).catch(() => {})
    await this.serializeAlarm(() => this.alarms.clearWakeup(RECOVERY_WAKEUP))
  }

  private async drop(preserveDeadline = false): Promise<void> {
    const opened = this.opened
    this.opened = undefined
    if (!opened) return
    await opened
      .then((o) => {
        this.retiring.add(o)
        return o.harness.close(context)
      })
      .catch(() => {})
    if (!preserveDeadline) await this.serializeAlarm(() => this.alarms.clearWakeup(RECOVERY_WAKEUP))
  }
}
