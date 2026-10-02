import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Models } from "@earendil-works/pi-ai"
import { type AgentChange, type Conversation, Harness, type HarnessSettings, type RegistryReader } from "@earendil-works/pi-durable"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import type { Envelope } from "@kiko/protocol"
import { type Alarms, createAlarms } from "../lib/alarm"
import { type CoalescingStorage, createCoalescingStorage } from "./coalescing-storage"
import { Inbox, renderInput } from "./inbox"
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

/** What the agent factory (P1-10) decides. The host calls it once per process, when it opens the harness. */
export type AgentSetup = {
  models: Models
  registry: RegistryReader
  /** Applied when the root conversation is created. */
  agent: AgentChange
  settings?: HarnessSettings
}

export type HostOptions = {
  setup: () => AgentSetup | Promise<AgentSetup>
  /** Runs once per process after the harness opens and before it resumes, so a watcher sees the resumed run. */
  onOpen?: (opened: Opened) => void | Promise<void>
  /** Default `HEARTBEAT_MS`. Tests pass less. Never more than `HEARTBEAT_MS`. */
  heartbeatMs?: number
}

export type Opened = { harness: Harness; root: Conversation; storage: CoalescingStorage }

export type HostStatus = {
  open: boolean
  inbox: { waiting: number; claimed: number; submitted: number }
  tasks: number
  submissions: number
}

export class AgentHost {
  readonly inbox: Inbox
  private readonly alarms: Alarms
  private readonly heartbeatMs: number
  private opened?: Promise<Opened>
  private failures = 0
  private watchingIdle = false

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
   * means "stored", and a repeated id was stored before.
   */
  async receive(envelopes: readonly Envelope[], brief: string): Promise<{ admitted: string[] }> {
    const { admitted, inserted } = this.inbox.admit(envelopes, brief)
    if (inserted > 0) await this.alarms.setWakeup(INBOX_WAKEUP, Date.now())
    return { admitted }
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
      await this.drain(opened.root)
      await this.pulse(opened.harness)
      this.failures = 0
    } catch (error) {
      this.failures++
      // Only the message: a provider error never carries the key, and nothing else is logged.
      console.error(`agent alarm failed (${this.failures}): ${error instanceof Error ? error.message : String(error)}`)
      await this.drop()
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
      const storage = createCoalescingStorage(await SqliteStorage.open(openDurableObjectSqlite(this.ctx.storage)))
      const harness = await Harness.open(storage, { models: setup.models, registry: setup.registry, settings: setup.settings }, context)
      const root = await harness.root(context, { agent: setup.agent })
      const opened = { harness, root, storage }
      await this.options.onOpen?.(opened)
      harness.resume()
      return opened
    })()
    // A failed open is not cached, so the next alarm tries again.
    opening.catch(() => {
      if (this.opened === opening) this.opened = undefined
    })
    this.opened = opening
    return opening
  }

  async status(): Promise<HostStatus> {
    const inbox = this.inbox.counts()
    if (!this.opened) return { open: false, inbox, tasks: 0, submissions: 0 }
    const { harness } = await this.opened
    const live = await harness.inspect(context)
    return { open: true, inbox, tasks: live.tasks.length, submissions: live.submissions.length }
  }

  /**
   * Submits every claimed batch as one input. While a run is busy `pi-durable` queues the input as a
   * follow-up. ASSUMPTION: restart and steer (section 6.2) come with the mid-run rules in P1-12.
   */
  private async drain(root: Conversation): Promise<void> {
    for (const batch of await this.inbox.claim()) {
      await root.submit({ type: "input", content: renderInput(batch), requestId: batch.requestId }, context)
      this.inbox.submitted(batch.requestId)
    }
  }

  /** Keeps the heartbeat while any task or submission is live, and removes it once the harness is idle. */
  private async pulse(harness: Harness): Promise<void> {
    const live = await harness.inspect(context)
    if (live.tasks.length === 0 && live.submissions.length === 0) {
      await this.alarms.clearWakeup(HEARTBEAT_WAKEUP)
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
        if (live.tasks.length === 0 && live.submissions.length === 0) await this.alarms.clearWakeup(HEARTBEAT_WAKEUP)
        else this.watchIdle(harness)
      })
      .catch(() => {
        // The harness closed or failed. The heartbeat stays armed and the next alarm reopens it.
        this.watchingIdle = false
      })
  }

  /** Forgets the harness after a failure. A fatal storage error poisons the session, so it is never reused. */
  private async drop(): Promise<void> {
    const opened = this.opened
    this.opened = undefined
    if (!opened) return
    await opened.then((o) => o.harness.close(context)).catch(() => {})
  }
}
