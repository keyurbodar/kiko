import { agentStorage } from "./storage"
import { JournalStorage } from "@kiko/agent/journal"
import type { ClockPort } from "@kiko/durable/clock-port"
import type { ClockMetadata } from "../owner/clock"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { AuthResult } from "@earendil-works/pi-ai"
import { type Conversation, type ConversationId, configure, type Harness, type ModelRef, type SubmissionId } from "@earendil-works/pi-durable"
import type { Activity, Envelope, ProviderProblem, RoomId, ThinkingLevel, WorkerRow } from "@kiko/protocol"
import { runKindFor } from "../user/provider-health"
import type { Env } from "../index"
import { AnswerWaiters } from "@kiko/agent/answers"
import type { OwnerServices, ServiceOptions } from "../owner/services"
import type { AgentHome } from "../room/room-do"
import type { Soul } from "../user/souls"
import { fakeSetup } from "./dev-fake"
import { imageReader } from "./extensions/files"
import type { GroupsPort } from "./extensions/chief"
import { shortBrief } from "../room/brief"
import { messageIdOf } from "../room/messaging"
import { CHIEF } from "../room/chief"
import { HOME } from "../files/upload"
import { homeBackend, ObjectCache, RoomFs, roomBackend, roomViews, type SoulPort, withMount, withSoul } from "../files/room-fs"
import { kikoDocsBackend, KIKO } from "../files/kiko-docs"
import { mergeRecall, tagHits } from "./recall"
import { type MemoryPort, memoryBlock, memoryDelta, parseZoomId } from "@kiko/memory/tools"
import { roomWorkspacePort } from "./extensions/workspace"
import type { MessagingPort } from "./extensions/messaging"
import { routineLine, type RoutinesPort } from "./extensions/routines"
import { canManageRoutine } from "./routine-access"
import type { RecipesPort } from "./extensions/skills"
import { type ComposioTool, learnedSignature } from "../integrations/composio/client"
import { learnedNote } from "../integrations/composio/tools"
import { integrationNote } from "./prompt"

import { buildAgent, openAgentHarness, userModels } from "./factory"
import { isKnownModel, parseModelRef, thinkingFor } from "./thinking"
import { setOverlay } from "../models/catalog"
import { projectRecovery } from "../owner/clock"
import { RoutineSchedules, captureRoutineTasks, scheduledRoutine, scheduledDeadline, type ScheduledRoutine } from "../owner/schedules"
import { AgentHost, type AgentSetup, type HostOptions, type HostStatus } from "@kiko/agent/host"
import type { Batch } from "@kiko/agent/input"
import type { Work } from "@kiko/agent/workers"
import { BROWSER_IDLE_WAKEUP, BrowserConnection } from "./browser/connection"
import { type LeasePort, type UserBrowserRpc, userLease } from "./browser/lease"

import { count, DEV, loadAgentDev } from "../lib/dev-guard"
import type { AgentDevHost, Usage } from "./dev"
import { Outbox, type RoomPort } from "./outbox"
import { stopsWorkers } from "./run-error"
import type { StepItem, StepsPort } from "./extensions/presence"

const WORKER_TASK_CHARS = 200
import { FIRST_BYTE_MS, guardStall, orStall, STALL_MS } from "./stall"
import { type Applied, modelName, renderHandoff, sameApplied, switchedModel } from "./handoff"

// Read by the dev methods in agent/dev.ts too, so they share one key per setting.
export const DEV_FAKE_KEY = "dev-fake"
const MEMORY_POS_KEY = "memory:pos"
const MEMORY_LIFE_KEY = "memory:life"
const MEMORY_REVISION_KEY = "memory:revision"
const MEMORY_FORGOTTEN_KEY = "memory:forgotten"
const MAX_DELTA_TURNS = 32
const USAGE_CARRIED_KEY = "usage:carried"
const COMPACTIONS_KEY = "compactions"
type EgressRequest = { url: string; method: string; headers: [string, string][]; body: ArrayBuffer | null }
const RECENT_WORKERS = 8
const MODEL_APPLIED_KEY = "model:applied"

const PRIVATE_REFUSAL = "this chat is private: nothing from it is saved to memory, your soul, or /home. carry on without saving."
const PRIVATE_NOTE = "this chat is private. use what you know, but save nothing from it: no memory, no soul edits, nothing in /home."

export class Agent {
  protected readonly hostOptions: Partial<HostOptions> = {}
  private hostInstance?: AgentHost
  private outboxInstance?: Outbox
  private afterHumanRun = false
  protected readonly answers = new AnswerWaiters()

  protected readonly ctx: DurableObjectState
  protected readonly env: Env
  private readonly services: OwnerServices
  private readonly requestRun: (requestId: string) => void | Promise<void>
  private readonly countOutgoing: () => void
  private readonly identity: { ownerId: string; roomId: string; slug: string }
  private readonly clock: ClockPort
  private readonly metadata: ClockMetadata
  private readonly agentKey: string
  constructor({ ctx, env, services, requestRun, countOutgoing = () => {}, identity, clock, metadata }: ServiceOptions & {
    identity: { ownerId: string; roomId: string; slug: string }
    clock: ClockPort
    metadata: ClockMetadata
    requestRun: (requestId: string) => void | Promise<void>
    countOutgoing?: () => void
  }) {
    this.identity = identity
    this.agentKey = `${identity.roomId}:${identity.slug}`
    this.clock = clock
    this.metadata = metadata
    const storage = agentStorage(ctx.storage, this.agentKey, clock)
    this.ctx = new Proxy(ctx, { get(target, key) {
      if (key === "storage") return storage
      const value = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    } })
    this.env = env
    this.services = services
    this.requestRun = requestRun
    this.countOutgoing = countOutgoing
  }

  loaded(): boolean { return this.hostInstance?.loaded() ?? false }
  async busy(): Promise<boolean> { return this.hostInstance?.busy() ?? false }
  async unload(): Promise<void> { await this.hostInstance?.unload() }
  async invalidate(): Promise<void> { await this.hostInstance?.invalidate() }
  protected get host(): AgentHost {
    this.hostInstance ??= new AgentHost(this.ctx, {
      clock: this.clock,
      agentKey: this.agentKey,
      projectTasks: (tasks, watches, current) => projectRecovery(tasks, watches, current, Date.now(), scheduledDeadline),
      openHarness: openAgentHarness,
      scheduledDeadline,
      requestRun: this.requestRun,
      progress: () => this.outbox.progress(),
      shortBrief,
      onReset: () => this.outbox.clear(),
      onWorkers: (running, pending) => void this.workersChanged(running, pending),
      waitUntil: (work) => this.ctx.waitUntil(work),
      ...this.hostOptions,
      setup: () => this.setup(),
      beforeIdle: (opened) => this.outbox.settle(opened.root),
      onIdle: async () => {
        await this.hostOptions.onIdle?.()
        const home = this.home()
        if (home && this.afterHumanRun) {
          this.afterHumanRun = false
          await this.services.afterRun(home.roomId, home.slug)
        }
        await this.services.trimAgents()
      },
      onOpen: async (opened) => {
        await this.hostOptions.onOpen?.(opened)
        this.#rootId = opened.root.id
        const home = this.home()
        if (home) {
          const { entries } = await opened.root.context(BACKGROUND_CONTEXT)
          const data = entries.findLast((entry) => entry.kind === "kiko.input")?.data
          if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.envelopeIds)) {
            this.#humanInputs = data.envelopeIds.flatMap((id) => typeof id === "string" && id.startsWith("human:") ? [id.slice(6).split("#")[0]!] : [])
          }
          if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.chain)) {
            const chain = data.chain.flatMap((value) => value && typeof value === "object" && !Array.isArray(value) && typeof value.rootId === "string" && typeof value.hop === "number" ? [{ rootId: value.rootId, hop: value.hop }] : [])
            this.services.room(home.roomId).restoreChain(home.slug, chain)
          }
        }
        await this.outbox.attach(opened.harness, opened.root.id, opened.storage)
        this.ctx.waitUntil(this.services.trimAgents())
      },
      onError: async (error, requestId) => {
        await this.hostOptions.onError?.(error, requestId)
        const inputs = (await this.host.envelopeIds(requestId))
          .filter((id) => id.startsWith("human:"))
          .map((id) => id.slice("human:".length).split("#")[0]!)
        if (inputs.length) this.#humanInputs = inputs
        if (this.#run) this.#run.errored = true
        await this.outbox.fail(requestId, error, this.#run?.provider ?? "")
      },
      onGiveUp: async () => {
        await this.hostOptions.onGiveUp?.()
        const home = this.home()
        if (home) await this.services.room(home.roomId).runDropped(home.slug)
      },
    })
    return this.hostInstance
  }

  private async workersChanged(running: number, pending: boolean): Promise<void> {
    await this.outbox.workers(this.workerRows()).catch(() => undefined)
    await this.outbox.background(running > 0, pending).catch(() => undefined)
    // The last worker settled and no run is going: its tabs go with it, so the chip hides while the agent is idle.
    if (running === 0 && !this.outbox.runId()) await this.releaseTabs()
  }

  private workerRows(): WorkerRow[] {
    return this.host.workers
      .list()
      .slice(-RECENT_WORKERS)
      .map((w) => ({ id: w.id, task: w.task, status: w.status, step: w.step, steps: w.steps, startedAt: w.startedAt }))
  }

  protected get outbox(): Outbox {
    this.outboxInstance ??= new Outbox(
      this.ctx.storage,
      () => this.roomPort(),
      () => {
        const epoch = this.host.epoch()
        return `${this.agentKey}${epoch ? `~${epoch}` : ""}`
      },
      Date.now,
      this.agentKey,
    )
    return this.outboxInstance
  }

  async receive(envelopes: Envelope[], brief: string, home?: AgentHome) {
    if (this.metadata.get("deleted")) throw new Error("agent deleted")
    if (home) this.setHome(home)
    const only = envelopes.length === 1 ? envelopes[0] : undefined
    const requestId = only?.from.kind === "agent" ? messageIdOf(only.id) ?? undefined : undefined
    const result = await this.host.receive(envelopes, brief, requestId)
    // A human message ends whatever ask_human is waiting on, so the agent answers them first.
    if (!result.refused && envelopes.some((e) => e.from.kind === "human")) this.answers.interrupt()
    return result
  }

  async stop(): Promise<{ discarded: number }> {
    return this.host.stop()
  }

  async erase(): Promise<void> {
    this.metadata.set("deleted", "1")
    await this.services.cancelRun(this.identity.roomId, this.identity.slug)
    await this.host.stop()
    await this.host.workers.stopAll()
    await this.releaseTabs()
    await this.host.shutdown()
    this.ctx.storage.transactionSync(() => {
      JournalStorage.clear(this.ctx.storage, this.agentKey)
      for (const table of ["workers", "worker_changes", "harness_epoch", "journal_ids", "agent_handoff"]) {
        this.ctx.storage.sql.exec(`DELETE FROM ${table} WHERE agent = ?`, this.agentKey)
      }
      this.metadata.delete("home")
      this.metadata.set("deleted", "1")
    })
    const keys = [...(await this.ctx.storage.list()).keys()]
    if (keys.length) await this.ctx.storage.delete(keys)
    for (const key of await this.clock.dueWakeups(Number.MAX_SAFE_INTEGER)) await this.clock.clearWakeup(key)
    await this.services.cancelRun(this.identity.roomId, this.identity.slug)
  }

  async scheduleRecovery(at: number): Promise<void> {
    const current = this.clock.deadline("recovery")
    if (current !== undefined && current > Date.now() && current <= at) return
    await this.clock.setWakeup("recovery", at)
  }

  async wake(): Promise<boolean> {
    return this.host.wake()
  }

  async status(): Promise<HostStatus & { alarmAt: number | null }> {
    return { ...(await this.host.status()), alarmAt: await this.ctx.storage.getAlarm() }
  }

  protected home(): AgentHome | null {
    const home = this.metadata.get("home")
    return home ? JSON.parse(home) as AgentHome : null
  }

  private homeOrThrow(): AgentHome {
    const home = this.home()
    if (!home) throw new Error("this agent has no room yet")
    return home
  }

  private setHome(home: AgentHome): void {
    const text = JSON.stringify(home)
    if (this.metadata.get("home") !== text) this.metadata.set("home", text)
  }

  protected roomPort(): RoomPort | null {
    const home = this.home()
    if (!home) return null
    const room = () => this.services.room(home.roomId)
    return {
      post: (runId, attempt, index, block) => room().post(home.slug, runId, attempt, index, block),
      draft: (runId, index, text) => room().draft(home.slug, runId, index, text),
      note: (runId, id, text) => room().note(home.slug, runId, id, text),
      status: async (state, detail) => {
        await room().setStatus(home.slug, state, detail)
      },
      workers: (rows) => room().setWorkers(home.slug, rows),
      endRun: async (runId, inputs = [], working = false) => {
        const { mail, mailOnly, human } = await this.heard(inputs).catch(() => ({ mail: [], mailOnly: false, human: false }))
        this.afterHumanRun ||= human
        this.recovered(home.userId)
        const ended = await room().endRun(home.slug, runId, mail, working, mailOnly)
        // The agent's tabs belong to its run: at the end of it the room's browser chip goes away. A worker still
        // running keeps them, and a human in control keeps them until they press Release control.
        if (!working) await this.releaseTabs()
        return ended
      },
      react: (emoji, messageId) => room().react(home.slug, emoji, messageId),
      // Restored from the durable input when the harness opens; Retry needs the messages it answered.
      runError: async (runId, error) => {
        const run = this.#run?.provider === error.provider ? this.#run : null
        if (run) run.errored = true
        const kind = runKindFor(error.kind, run?.credential)
        const out = await room().runError(home.slug, runId, { ...error, kind, inputs: this.#humanInputs })
        // A failure the provider repeats on the next request ends the work with the run. A busy or
        // unreachable provider leaves the workers alone: they may still finish and report.
        if (stopsWorkers(kind)) await this.host.workers.stopAll()
        return out
      },
    }
  }

  /** A run that started with a provider problem and ended without a model error proves the provider works. */
  private recovered(userId: string): void {
    const run = this.#run
    if (!run?.problem || run.errored || !run.auth) return
    run.problem = undefined
    this.ctx.waitUntil(
      this.services.user()
        .providerRecovered(run.provider)
        .catch((e: unknown) => console.error(`provider recovery failed: ${e instanceof Error ? e.message : String(e)}`)),
    )
  }

  private recipesPort(home: { userId: string; roomId: string; slug: string }): RecipesPort {
    const user = () => this.services.user()
    return { list: () => user().recipeBriefs(home.roomId, home.slug), body: (name) => user().recipeSkillText(name) }
  }

  private routinesPort(): RoutinesPort | null {
    const home = this.home()
    if (!home) return null
    const user = () => this.services.user()
    const tz = () => this.#run?.timezone ?? "UTC"
    const mine = async (id: string) => (await user().listRoutines()).some((r) => r.id === id && canManageRoutine(home, r))
    const notHere = { ok: false as const, error: "no such routine available to you" }
    return {
      list: async () => (await user().listRoutines()).filter((r) => canManageRoutine(home, r)),
      delete: async (id) => {
        const routine = (await user().listRoutines()).find((r) => r.id === id)
        if (routine && !canManageRoutine(home, routine)) return notHere
        return user().deleteRoutine(id)
      },
      cancel: async (id) => ((await mine(id)) ? user().cancelRoutine(id) : notHere),
      createRoutine: async (input) => {
        return user().createRoutine(home.userId, { ...input, target: input.target ?? home.slug, tz: tz(), roomId: home.roomId as RoomId, createdBy: home.slug })
      },
      updateRoutine: async (id, patch) => ((await mine(id)) ? user().updateRoutine(id, patch) : notHere),
      runRoutine: async (id) => ((await mine(id)) ? user().runRoutine(id) : null),
      runs: async (id) => ((await mine(id)) ? user().routineRuns(id) : []),
      origin: () => user().publicOrigin(),
      addRecipe: async (slug) => {
        const out = await user().installRecipe(home.userId, { installId: crypto.randomUUID(), slug, roomId: home.roomId as RoomId, agent: home.slug }, home.slug)
        if (out.ok) return { ok: true, setup: out.setup, existed: out.existed }
        if ("needsConnect" in out) {
          const { links, reason } = out.needsConnect
          return { ok: false, error: links.length ? `nothing was added. these apps are not connected yet. send the human these links, and add the recipe again once they connect: ${links.map((l) => `[Connect ${l.app}](${l.url})`).join(" ")}` : `nothing was added. ${reason}` }
        }
        return out
      },
    }
  }

  private async composioTools(): Promise<ComposioTool[] | null | "unreachable"> {
    const home = this.home()
    if (!home) return null
    return this.services.user()
      .composioTools()
      .catch(() => "unreachable" as const)
  }

  async humanComing(): Promise<void> {
    this.host.humanComing()
    this.answers.interrupt()
  }

  async humanGone(): Promise<void> {
    await this.host.humanGone()
  }

  /** The agent mail a run answered, and whether mail was all it was given: such a run says nothing the human committed to. */
  private async heard(inputs: readonly SubmissionId[]): Promise<{ mail: string[]; mailOnly: boolean; human: boolean }> {
    if (!inputs.length) return { mail: [], mailOnly: false, human: false }
    const { storage } = await this.host.open()
    const all: string[] = []
    for (const input of inputs) {
      const submission = await storage.submission(input, BACKGROUND_CONTEXT)
      if (submission?.requestId) all.push(...await this.host.envelopeIds(submission.requestId))
    }
    const mail = all.filter((id) => id.startsWith("agent:"))
    return { mail, mailOnly: mail.length > 0 && mail.length === all.length, human: all.some((id) => id.startsWith("human:")) }
  }

  async askAnswered(id: string, answer: string): Promise<boolean> {
    return this.answers.answer(id, answer)
  }

  private messagingPort(): MessagingPort | null {
    const home = this.home()
    if (!home) return null
    const room = () => this.services.room(home.roomId)
    return {
      send: (input) => room().agentMessage(home.slug, input),
      waitAnswer: (id, ms, signal) => this.answers.wait(id, ms, signal),
      askHuman: (input) => room().askHuman(home.slug, input),
      humanAskState: (id) => room().humanAskState(id),
      humanWaiting: () => this.host.humanWaiting(),
      team: () => room().teamNow(),
    }
  }

  #rootId: ConversationId | null = null

  private stepsPort(): StepsPort {
    return {
      push: (item) => {
        const home = this.home()
        if (home) this.ctx.waitUntil(this.services.room(home.roomId).reportSteps(home.slug, [item]))
      },
      scope: (conversationId) => {
        if (conversationId === this.#rootId) {
          const runId = this.outbox.runId()
          return runId ? { runId } : null
        }
        const work = this.host.workers.byConversation(conversationId)
        return work?.runId ? { runId: work.runId, worker: { id: work.id, task: work.task.slice(0, WORKER_TASK_CHARS) } } : null
      },
    }
  }

  private groupsPort(): GroupsPort | undefined {
    const home = this.home()
    if (!home) return undefined
    const room = () => this.services.room(home.roomId)
    return {
      chief: home.slug === CHIEF,
      agents: () => this.services.user().listAgents(),
      createAgent: (spec) => room().createAgent(home.slug, spec),
      createGroup: (input) => room().createGroup(home.slug, input),
      deleteGroup: (roomId) => room().deleteGroup(home.slug, roomId),
      deleteAgent: (handle) => room().deleteOwnedAgent(home.slug, handle),
      removeMember: (handle, roomId) => room().removeGroupMember(home.slug, handle, roomId),
      overview: () => this.services.user().overview(),
    }
  }

  private soulPort(): SoulPort {
    const user = () => {
      const home = this.homeOrThrow()
      return { stub: this.services.user(), slug: home.slug }
    }
    return {
      get: () => {
        const { stub, slug } = user()
        return stub.soul(slug)
      },
      forPrompt: async () => this.#run?.soul ?? (await user().stub.soul(user().slug)),
      set: async (body, expectSha) => {
        if (this.home()?.private) return { ok: false, code: "invalid", message: PRIVATE_REFUSAL }
        const { stub, slug } = user()
        const out = await stub.setSoul(slug, body, expectSha)
        if (out.ok && this.#run) this.#run.soul = out.soul
        return out
      },
    }
  }

  /** Routines are durable pi tasks in this agent's Harness, so they share the run mechanism and the one clock. */
  private readonly routineScheduler = new RoutineSchedules(async (delivery) => {
    await this.services.fireRoutine(delivery)
  })

  /** Replaces this agent's durable routine inventory. Repeated syncs with the same occurrences add nothing. */
  async syncRoutines(routines: readonly ScheduledRoutine[]): Promise<void> {
    await this.host.updateTasks(async (opened) => {
      await this.routineScheduler.bind(opened.harness, opened.root.id).sync(routines)
    })
  }

  protected async setup(): Promise<AgentSetup> {
    const rollover: NonNullable<AgentSetup["rollover"]> = {
      capture: (tasks) => captureRoutineTasks(tasks),
      restore: (harness, root, input) => this.routineScheduler.bind(harness, root.id).sync(input.map(scheduledRoutine)),
    }
    const home = this.home()
    const role = { role: home?.role ?? "", lead: home?.lead ?? true }
    const messaging = () => this.messagingPort()
    if (DEV && (await this.ctx.storage.get<boolean>(DEV_FAKE_KEY))) {
      const browserOn = await this.browserOn()
      const fake = fakeSetup(role, roomWorkspacePort(this.services, () => this.home()), messaging, {
        testExtensions: [this.routineScheduler.extension],
        ...(browserOn && home ? { browser: { connection: () => this.browser(), lease: () => this.browserLease(), acceptsImages: () => false } } : {}),
        routines: { port: () => this.routinesPort() },
        groups: this.groupsPort(),
        work: this.host.workers,
        presence: this.stepsPort(), runId: () => this.outbox.runId(),
      })
      return {
        ...fake,
        rollover,
        beginRun: async () => true,
        inputMemory: (batch, fresh, joined) => this.inputMemory(batch, fresh, joined, false),
        beforeCompact: (harness) => this.beforeCompact(harness),
      }
    }
    const egress = this.egressFetch()
    const user = userModels((provider) => this.runAuth(provider), `${this.identity.ownerId}:${this.agentKey}`, egress, this.countOutgoing)
    const soul = this.soulPort()
    const cache = new ObjectCache()
    const where = () => this.home()
    const notice = (text: string) => {
      const h = this.home()
      return h ? this.services.room(h.roomId).homeNotice(h.slug, text) : Promise.resolve()
    }
    const locked = () => (this.home()?.private ? PRIVATE_REFUSAL : null)
    const backend = withMount(withMount(roomBackend(this.services, where, cache), HOME, homeBackend(this.services, where, notice, cache, locked)), KIKO, kikoDocsBackend())
    const id = `room-files:${this.identity.ownerId}:${this.agentKey}`
    const space = withSoul(backend, soul)
    const views = roomViews(id, space)
    const files = { fs: new RoomFs(id, space), acceptsImages: imageReader(user.models) }
    const memory = this.memoryPort()
    const composio = await this.composioTools()
    const signature = Array.isArray(composio) ? learnedSignature(composio) : composio
    const browserOn = await this.browserOn()
    const browser = browserOn && home
      ? { connection: () => this.browser(), lease: () => this.browserLease(), acceptsImages: imageReader(user.models) }
      : undefined
    const picked = await this.picked()
    const built = buildAgent({ ...(browser ? { browser } : {}), testExtensions: [this.routineScheduler.extension], ...role, ...(picked.model ? { model: picked.model } : {}), thinkingLevel: picked.thinking, files, soul, runStamp: () => this.#runStamp, groups: this.groupsPort(), presence: this.stepsPort(), runId: () => this.outbox.runId(), memory, messaging, routines: { port: () => this.routinesPort() }, ...(home ? { recipes: this.recipesPort(home) } : {}), ...(Array.isArray(composio) && home ? { composio: { tools: composio, call: (name, args) => this.services.user().composioCall(name, args, egress), resolve: (app) => this.services.user().composioToolkit(app) } } : {}), workspace: roomWorkspacePort(this.services, () => this.home()), work: this.host.workers })
    return {
      ...built,
      ...user,
      rollover,
      env: views,
      beginRun: async (batch, root) => {
        this.prefetchDelta(batch)
        return this.beginRun(batch, root)
      },
      inputContext: async () => {
        const tz = this.#run?.timezone ?? "UTC"
        const clock = `now: ${new Date().toISOString()} (${tz}, ${new Date().toLocaleString("en-US", { timeZone: tz, weekday: "long", hour: "numeric", minute: "2-digit" })})`
        const down = composio === "unreachable" ? "composio (the human's connected apps) is unreachable right now, so its tools are missing this run." : undefined
        const integrations = integrationNote(composio, browserOn)
        const learned = Array.isArray(composio) ? learnedNote(composio) : undefined
        const quiet = this.home()?.private ? PRIVATE_NOTE : undefined
        const routines = await this.routineContext()
        return [clock, integrations, down, learned, quiet, routines].filter(Boolean).join("\n\n")
      },
      ...(home ? { stale: async () => (await this.browserOn()) !== browserOn || (signature !== "unreachable" && (this.services.user().composioSignature() !== signature)) } : {}),
      inputInvalidated: () => this.inputInvalidated(),
      inputMemory: (batch: Batch, fresh: boolean, joined: number[]) => this.inputMemory(batch, fresh, joined),
      beforeCompact: (harness) => this.beforeCompact(harness),
    }
  }

  private async routineContext(): Promise<string> {
    const live = (await this.routinesPort()?.list() ?? []).filter((routine) => routine.status === "active" || routine.status === "paused" || routine.status === "failed")
    const inventory = live.slice(0, 32).map((routine) => routineLine(routine))
    return `Live routines (current; replaces earlier inventories):\n${inventory.join("\n") || "(none)"}${live.length > inventory.length ? `\n${live.length - inventory.length} more; use list_routines for the full list.` : ""}`
  }

  private async inputInvalidated(): Promise<"refresh" | "forget" | null> {
    const home = this.home()
    if (!home) return null
    const [known, forgotten, current] = await Promise.all([
      this.ctx.storage.get<number>(MEMORY_REVISION_KEY),
      this.ctx.storage.get<number>(MEMORY_FORGOTTEN_KEY),
      this.services.user().lifeRevisions(),
    ])
    if ((forgotten ?? 0) !== current.forgotten) return "forget"
    return known !== current.revision ? "refresh" : null
  }

  private async inputMemory(batch: Batch, fresh: boolean, joined: number[], withLife = true): Promise<{ text?: string; fresh: boolean; data?: { memoryPos: number } }> {
    const ahead = this.#delta?.requestId === batch.requestId ? this.#delta.since : null
    this.#delta = undefined
    const home = this.home()
    if (!home) return { fresh }
    const room = this.services.room(home.roomId)
    const seqs = [...batch.envelopes.map((e) => e.seq), ...joined]
    this.#seqs = seqs
    this.#heard = batch.envelopes.findLast((e) => e.from.kind === "human")?.rootId ?? null
    this.#humanInputs = batch.envelopes.filter((e) => e.from.kind === "human").map((e) => e.rootId)
    const [seen, previousLife, previousRevision, state] = await Promise.all([
      this.memoryPos(),
      withLife ? this.ctx.storage.get<string>(MEMORY_LIFE_KEY) : undefined,
      withLife ? this.ctx.storage.get<number>(MEMORY_REVISION_KEY) : undefined,
      withLife ? this.services.user().lifeState() : { text: "", revision: 0, forgotten: 0 },
    ])
    const life = state.text
    const changedLife = withLife && (state.revision !== previousRevision || life !== previousLife)
    if (!fresh && !changedLife && seen !== undefined) {
      const delta = (await ahead) ?? (await room.memorySince(home.slug, seen, seqs))
      if (delta.count - seen <= MAX_DELTA_TURNS) {
        return { fresh: false, data: { memoryPos: delta.count }, ...(delta.text ? { text: memoryDelta(delta.text) } : {}) }
      }
    }
    const currentSeqs = batch.envelopes.map((envelope) => envelope.seq)
    this.#seqs = currentSeqs
    const view = await room.memoryView(currentSeqs)
    if (withLife) await this.ctx.storage.put({ [MEMORY_LIFE_KEY]: life, [MEMORY_REVISION_KEY]: state.revision, [MEMORY_FORGOTTEN_KEY]: state.forgotten })
    this.#shown.clear()
    return { fresh: true, text: memoryBlock(life, view.text), data: { memoryPos: view.count } }
  }

  private async memoryPos(): Promise<number | undefined> {
    const data = await this.host.inputData("memoryPos")
    return typeof data?.memoryPos === "number" ? data.memoryPos : this.ctx.storage.get<number>(MEMORY_POS_KEY)
  }

  #seqs: number[] = []
  #heard: string | null = null
  /** The human messages the run in flight is answering, so a failed run can be run again. */
  #humanInputs: string[] = []
  #shown = new Set<string>()
  #delta?: { requestId: string; since: Promise<{ text: string; count: number } | null> }

  private prefetchDelta(batch: Batch): void {
    const home = this.home()
    if (!home) return
    const since = (async () => {
      const seen = await this.memoryPos()
      if (seen === undefined) return null
      const seqs = [...batch.envelopes.map((e) => e.seq), ...(await this.host.joinedSeqs())]
      return this.services.room(home.roomId).memorySince(home.slug, seen, seqs)
    })().catch(() => null)
    this.#delta = { requestId: batch.requestId, since }
  }

  private async beforeCompact(harness: Harness): Promise<void> {
    const now = await this.usageOf(harness)
    const carried = await this.carriedUsage()
    const usage = { input: carried.input + now.input, output: carried.output + now.output, cacheRead: carried.cacheRead + now.cacheRead, cacheWrite: carried.cacheWrite + now.cacheWrite }
    const home = this.home()
    if (!home) {
      await this.ctx.storage.put(USAGE_CARRIED_KEY, usage)
      return
    }
    const count = ((await this.ctx.storage.get<number>(COMPACTIONS_KEY)) ?? 0) + 1
    // One put for both keys: the usage this compaction carries and the compaction count.
    await this.ctx.storage.put({ [USAGE_CARRIED_KEY]: usage, [COMPACTIONS_KEY]: count })
    await this.services.room(home.roomId).compacted(home.slug, String(count)).catch(() => {})
  }

  private async carriedUsage(): Promise<Usage> {
    return (await this.ctx.storage.get<Usage>(USAGE_CARRIED_KEY)) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  }

  // The one guarded entry for the dev methods in agent/dev.ts: they reach the object's state here.
  private agentDevHost(): AgentDevHost {
    return {
      storage: this.ctx.storage,
      home: () => this.home(),
      opened: () => this.host.open(),
      usageOf: (harness) => this.usageOf(harness),
      carried: () => this.carriedUsage(),
      workers: () => this.host.workers.list(),
    }
  }

  private async usageOf(harness: Harness): Promise<Usage> {
    const usage = await harness.usage(BACKGROUND_CONTEXT)
    const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    for (const u of Object.values(usage.models) as unknown as (typeof sum)[]) {
      sum.input += u.input
      sum.output += u.output
      sum.cacheRead += u.cacheRead
      sum.cacheWrite += u.cacheWrite
    }
    return sum
  }

  /** The owner transport reserves the active invocation budget once per network attempt. */
  async egress(request: EgressRequest): Promise<Response> {
    if (new URL(request.url).protocol !== "https:") throw new Error("egress is https only")
    return this.services.egress(request)
  }

  /**
   * A `fetch` that goes out through `egress`. An abort signal cannot cross RPC, so it is applied
   * here: before the call it throws, and after it the body stream is cut.
   */
  private egressFetch(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      signal?.throwIfAborted()
      // The request crosses as plain data: a request body streamed over RPC can be cut off before the
      const request = new Request(input as RequestInfo, { ...init, signal: null })
      const body = request.body ? await request.arrayBuffer() : null
      const sent = await orStall(this.egress({ url: request.url, method: request.method, headers: [...request.headers], body }), FIRST_BYTE_MS)
      const response = guardStall(sent, STALL_MS)
      if (!signal || !response.body) return response
      const { readable, writable } = new TransformStream()
      response.body.pipeTo(writable, { signal }).catch(() => {})
      return new Response(readable, { status: response.status, statusText: response.statusText, headers: response.headers })
    }) as typeof fetch
  }

  private memoryPort(): MemoryPort | undefined {
    const home = this.home()
    if (!home) return undefined
    const user = () => this.services.user()
    const room = () => this.services.room(home.roomId)
    return {
      note: async (text, replaces) =>
        this.home()?.private ? { ok: false, error: PRIVATE_REFUSAL } : user().lifeNote(home.slug, text, this.#heard ? `room:${home.roomId}:msg:${this.#heard}` : "", replaces),
      captures: () => this.#run?.captures ?? false,
      recall: async (query, conversationId) => {
        const root = await this.isRootConversation(conversationId)
        const seen = root ? await this.memoryPos() : undefined
        const [life, chat] = await Promise.all([user().lifeRecall(query), room().memoryRecall(query, seen, root ? this.#seqs : [])])
        return mergeRecall(tagHits("life", life), tagHits("chat", chat), root ? this.#shown : new Set())
      },
      zoom: async (raw) => {
        const id = parseZoomId(raw)
        if (!id) return null
        return id.log === "life" ? user().lifeZoom(id.id) : room().memoryZoom(id.id)
      },
    }
  }

  private async isRootConversation(conversationId: ConversationId): Promise<boolean> {
    return conversationId === (await this.host.rootId())
  }

  /** The model and level the conversation was last configured with, and the one it needs now. */
  private async applied(): Promise<Applied | undefined> {
    return this.ctx.storage.get<Applied>(MODEL_APPLIED_KEY)
  }

  /** True when the conversation has model context to hand over. A fresh conversation has none. */
  private async hasContext(root: Conversation): Promise<boolean> {
    return (await root.context(BACKGROUND_CONTEXT)).messages.length > 0
  }

  private async handoff(root: Conversation, was: Applied, next: Applied): Promise<void> {
    const { entries } = await root.context(BACKGROUND_CONTEXT)
    const previous = entries.findLast((entry) => entry.kind === "kiko.handoff")
    const marker = previous?.data
    const applied = marker && typeof marker === "object" && !Array.isArray(marker) ? marker.applied : undefined
    if (JSON.stringify(applied) !== JSON.stringify(next)) {
      const text = renderHandoff(entries, { from: modelName(was.model), to: modelName(next.model) })
      await root.commit((tx) => tx.appendEntry(root.id, {
        kind: "kiko.handoff", data: { applied: next }, head: "self",
        model: [{ role: "user", content: text, timestamp: Date.now() }],
      }), BACKGROUND_CONTEXT)
    }
    await root.configure(next, BACKGROUND_CONTEXT)
  }

  #run: { provider: string; auth: AuthResult | null; timezone: string; captures: boolean; soul?: Soul; credential?: "api_key" | "oauth"; problem?: ProviderProblem; errored?: boolean } | null = null
  #runStamp = 0

  protected async beginRun(batch: Batch, root: Conversation): Promise<boolean> {
    const home = this.home()
    if (!home) return false
    this.#runStamp++
    const turn = await this.services.user().agentTurn(home.slug)
    if (turn.provider) setOverlay(turn.provider, turn.catalog.models)
    const model = turn.model ? parseModelRef(turn.model) : null
    // pi-durable ends a run on a model it cannot find as unanswered, with no error entry, so the human would see nothing.
    const listed = model ? isKnownModel(model) : false
    if (model && listed) {
      this.#run = { provider: model.provider, auth: turn.auth, timezone: turn.timezone, captures: turn.captures, ...(turn.credential ? { credential: turn.credential } : {}), ...(turn.problem ? { problem: turn.problem } : {}), ...(turn.agent ? { soul: turn.agent.soul } : {}) }
      const applied = { model, thinkingLevel: turn.thinking }
      const was = await this.ctx.storage.get<Applied>(MODEL_APPLIED_KEY)
      if (!sameApplied(was, applied)) {
        // A new model never reads the old model's native history: a thinking signature or tool-call shape it does not
        // know answers 400 on every later message. It reads a plain-text handoff instead.
        if (was && switchedModel(was, applied) && (await this.hasContext(root))) await this.handoff(root, was, applied)
        else await root.configure(applied, BACKGROUND_CONTEXT)
        await this.ctx.storage.put(MODEL_APPLIED_KEY, applied)
      }
      if (turn.auth) return true
    }
    const requestId = batch.requestId
    const ids = batch.envelopes.map((e) => e.id)
    const heard = ids.filter((id) => id.startsWith("agent:"))
    const humans = ids.filter((id) => id.startsWith("human:")).map((id) => id.slice("human:".length).split("#")[0]!)
    const room = this.services.room(home.roomId)
    if (!model) await room.noModel(home.slug, requestId, heard, humans)
    else if (!listed) await room.modelGone(home.slug, model.provider, `${model.provider}/${model.modelId}`, requestId, heard, humans)
    else {
      const why = turn.authProblem === "signed_out" ? "signed_out" : turn.authProblem === "unreachable" ? "network" : "no_key"
      await room.noProvider(home.slug, model.provider, requestId, heard, humans, why)
    }
    return false
  }

  private async runAuth(provider: string): Promise<AuthResult | undefined> {
    if (this.#run?.provider === provider) return this.#run.auth ?? undefined
    return (await this.loadAuth(provider)) ?? undefined
  }

  private async loadAuth(provider: string): Promise<AuthResult | null> {
    const home = this.home()
    const context = home ? await this.services.user().turnContext(provider, home.slug) : null
    if (context) setOverlay(provider, context.catalog.models)
    this.#run = { provider, auth: context?.auth ?? null, timezone: context?.timezone ?? "UTC", captures: context?.captures ?? false, ...(context?.credential ? { credential: context.credential } : {}), ...(context?.problem ? { problem: context.problem } : {}), ...(context?.agent ? { soul: context.agent.soul } : {}) }
    return this.#run.auth
  }

  /** The model and level this agent runs on. Kept by the user, so every chat with this agent agrees. */
  private async picked(): Promise<{ model: ModelRef | null; thinking: ThinkingLevel }> {
    const home = this.home()
    const picked = home ? await this.services.user().agentModel(home.slug) : null
    return { model: picked ? parseModelRef(picked.model) : null, thinking: picked?.thinking ?? "off" }
  }

  async model(): Promise<ModelRef | null> {
    return (await this.picked()).model
  }

  async alarm() {
    if (await this.browserIdle()) return
    await this.host.alarm()
  }

  async runInvocation(due: () => boolean): Promise<"done" | "continue"> {
    if (await this.browserIdle()) return "done"
    return this.host.runInvocation(due)
  }

  #browser?: BrowserConnection
  #browserLease?: LeasePort

  private async browserOn(): Promise<boolean> {
    const home = this.home()
    if (!home) return false
    return (this.services.user() as unknown as UserBrowserRpc).browserCheck().then((s) => s.connected, () => false)
  }

  /**
   * Closes the agent's tabs and drops its claim from the lease, once its run ends. The browser and its logins stay for
   * the next run; the chip above the composer hides because no tab is left. Safe to call twice, and when no tab was open.
   */
  async releaseTabs(): Promise<number> {
    if (!this.#browser) return 0
    return this.#browser.release().catch((e: unknown) => {
      console.error(`browser release failed: ${e instanceof Error ? e.message : String(e)}`)
      return 0
    })
  }

  private browserLease(): LeasePort {
    const home = this.homeOrThrow()
    this.#browserLease ??= userLease(() => this.services.user() as unknown as UserBrowserRpc, `${home.roomId}:${home.slug}`, home.roomId)
    return this.#browserLease
  }

  private browser(): BrowserConnection {
    const home = this.homeOrThrow()
    this.#browser ??= new BrowserConnection({
      agentId: `${home.roomId}:${home.slug}`,
      lease: this.browserLease(),
      idle: { arm: (at) => this.clock.setWakeup(BROWSER_IDLE_WAKEUP, at) },
    })
    return this.#browser
  }

  /**
   * Closes the browser socket when its idle wakeup is due. The host's alarm would drop the row as
   * due without knowing it, so this runs first. True when nothing else was due.
   */
  private async browserIdle(): Promise<boolean> {
    const clock = this.clock
    const at = clock.deadline(BROWSER_IDLE_WAKEUP)
    if (at === undefined || at > Date.now()) return false
    await clock.clearWakeup(BROWSER_IDLE_WAKEUP)
    if (this.#browser && (await this.#browser.idle()) === "closed") count("browser.idle.closed")
    return false
  }

  // The dev-only bodies live in agent/dev.ts, which only a development build can load. One cached load
  // per object reaches every dev method below.
  #dev?: Promise<typeof import("./dev")>

  private dev(): Promise<typeof import("./dev")> {
    this.#dev ??= loadAgentDev()
    return this.#dev
  }

  async devUsage(): Promise<Usage> {
    return (await this.dev()).devUsage(this.agentDevHost())
  }

  async devTrace(): Promise<{ kind: string; tool?: string; chars: number; text?: string }[]> {
    return (await this.dev()).devTrace(this.agentDevHost())
  }

  async devFake(): Promise<void> {
    return (await this.dev()).devFake(this.agentDevHost())
  }

  async devWorkers(): Promise<Work[]> {
    return (await this.dev()).devWorkers(this.agentDevHost())
  }
}
