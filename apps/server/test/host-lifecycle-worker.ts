import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, defineTask, defineTool, type TaskId } from "@earendil-works/pi-durable"
import { createAlarms } from "@kiko/durable/alarm"
import { declareEffect } from "@kiko/agent/effects"
import type { AgentSetup, HostOptions } from "@kiko/agent/host"
import type { Envelope } from "@kiko/protocol"
import { AgentProbe as AgentDO, agentObject } from "./agent-service"
import { buildAgent } from "../src/agent/factory"
import type { RoomPort } from "../src/agent/outbox"

const future = defineTask<{ at: number }, { phase: "wait" }, null>({
  name: "test.future", version: 1, initial: () => ({ phase: "wait" }),
  phases: { wait: async (task, runtime, context) => {
    await runtime.sleep(task.input.at, context)
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context)
  } },
})
const missing = defineTask({ ...future.definition, name: "test.missing" })

class TService extends AgentDO {
  private readonly instance = crypto.randomUUID()
  private waited = 0
  private futureIds: TaskId[] = []
  private readonly crashed = Promise.withResolvers<void>()
  protected override readonly hostOptions: Partial<HostOptions> = {
    scheduledDeadline: (task) => {
      const input = task.record.input
      if (task.record.kind === future.definition.name && input && typeof input === "object" && "at" in input && typeof input.at === "number") return input.at
      return undefined
    },
    onOpen: ({ harness }) => {
      const waitForTask = harness.waitForTask.bind(harness)
      harness.waitForTask = (id, context) => { this.waited++; return waitForTask(id, context) }
    },
    onIdle: () => { void this.ctx.storage.put("finished", true) },
  }

  protected override roomPort(): RoomPort {
    return {
      post: async (_runId, _attempt, _index, text) => {
        await this.ctx.storage.put("reply", text)
      },
      draft: async () => {}, note: async () => {}, status: async () => {}, workers: async () => {},
      endRun: async () => {}, react: async () => {},
      runError: async (runId) => {
        const ids = (await this.ctx.storage.get<string[]>("errors")) ?? []
        await this.ctx.storage.put("errors", [...ids, runId])
      },
    }
  }

  protected override async setup(): Promise<AgentSetup> {
    const mode = await this.ctx.storage.get<string>("mode")
    if (!mode) throw new Error("host setup failed")
    const wait = declareEffect("read", defineTool({
      name: "wait", description: "Resume after eviction", parameters: Type.Object({}), replay: "safe",
      execute: async () => {
        const calls = ((await this.ctx.storage.get<number>("tool-calls")) ?? 0) + 1
        await this.ctx.storage.put("tool-calls", calls)
        if (calls === 1) {
          await this.ctx.storage.put("crash", {
            instance: this.instance,
            alarmAt: await this.ctx.storage.getAlarm(),
            wakeups: this.ctx.storage.sql.exec("SELECT key, at FROM wakeups").toArray(),
            at: Date.now(),
          })
          await this.ctx.storage.sync()
          this.crashed.resolve()
          this.ctx.abort("host lifecycle eviction during tool")
        }
        return { output: [{ type: "text", text: "continued" }] }
      },
    }))
    const fill = declareEffect("write", defineTool({
      name: "fill", description: "Fill this agent's journal", parameters: Type.Object({}), replay: "safe",
      execute: async (_args, api, context) => {
        const rows = mode === "compact-rows"
        for (let n = 0; n < (rows ? 501 : 5); n++) {
          await api.commit((tx) => tx.appendEntry(api.conversationId, { kind: "test.padding", data: { text: rows ? "x" : "x".repeat(900_000) } }), context)
        }
        const size = this.ctx.storage.sql.exec("SELECT count(*) AS rows, sum(length(data)) AS bytes FROM journal WHERE agent = 'agent'").one()
        await this.ctx.storage.put("filled", { ...size, epoch: this.host.epoch() })
        return { output: [{ type: "text", text: "filled" }] }
      },
    }))
    const faux = fauxProvider({ tokensPerSecond: 10000 })
    faux.setResponses(Array.from({ length: 10 }, () => (request) => {
      if (mode === "fail") return fauxAssistantMessage("", { stopReason: "error", errorMessage: "permanent test failure" })
      if (mode === "crash" && !request.messages.some((message) => message.role === "toolResult")) {
        return fauxAssistantMessage(fauxToolCall("wait", {}, { id: "wait-call" }), { stopReason: "toolUse" })
      }
      if (mode.startsWith("compact-") && !request.messages.some((message) => message.role === "toolResult")) {
        return fauxAssistantMessage(fauxToolCall("fill", {}, { id: "fill-call" }), { stopReason: "toolUse" })
      }
      return fauxAssistantMessage("Finished.")
    }))
    const models = createModels()
    models.setProvider(faux.provider)
    const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, work: this.host.workers, testExtensions: [defineExtension({ name: "lifecycle", tools: [wait, fill], tasks: [future] })] })
    return { models, ...built, settings: { ...built.settings, retry: { maxRetries: 0 } }, beginRun: async () => true,
      beforeCompact: async (harness) => {
        const usage = await harness.usage(BACKGROUND_CONTEXT)
        const output = Object.values(usage.models).reduce((total, model) => total + model.output, 0)
        await this.ctx.storage.put({
          "carried-output": ((await this.ctx.storage.get<number>("carried-output")) ?? 0) + output,
          "compactions": ((await this.ctx.storage.get<number>("compactions")) ?? 0) + 1,
        })
      },
    }
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.put("alarm-entries", ((await this.ctx.storage.get<number>("alarm-entries")) ?? 0) + 1)
    await super.alarm()
  }

  override async fetch(request: Request): Promise<Response> {
    const op = new URL(request.url).pathname.slice(1)
    if (op === "normal") {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS recovery_changes (kind TEXT NOT NULL)")
      for (const kind of ["INSERT", "UPDATE", "DELETE"]) {
        const key = kind === "DELETE" ? "old.key" : "new.key"
        this.ctx.storage.sql.exec(`CREATE TRIGGER IF NOT EXISTS recovery_${kind} AFTER ${kind} ON wakeups WHEN ${key} = 'recovery' BEGIN INSERT INTO recovery_changes VALUES ('${kind}'); END`)
      }
    }
    if (["normal", "fail", "crash", "compact-rows", "compact-bytes"].includes(op)) {
      await this.ctx.storage.put("mode", op)
      await this.ctx.storage.put("finished", false)
      const requestId = crypto.randomUUID()
      const envelope: Envelope = { id: `human:${requestId}`, roomId: "01J00000000000000000000000" as Envelope["roomId"], from: { kind: "human" }, body: "hi", hop: 0, rootId: requestId, seq: 1 }
      await this.receive([envelope], "")
      await super.alarm()
      if (op === "crash") await this.crashed.promise
    }
    if (op === "deadlines") {
      await this.ctx.storage.put("mode", "normal")
      const { harness, root } = await this.host.open()
      const times = [Date.now() + 120_000, Date.now() + 180_000]
      await this.ctx.storage.put("future-times", times)
      await createAlarms(this.ctx).setWakeup("browser-idle", times[1]! + 60_000)
      this.futureIds = await harness.commit(async (tx) => {
        const options = { ownership: { kind: "conversation" as const }, conversationId: root.id }
        const ids = []
        for (const at of times) ids.push(await tx.createTask(future, { at }, options))
        await tx.createTask(missing, { at: times[0]! - 60_000 }, options)
        return ids
      }, BACKGROUND_CONTEXT)
    }
    if (op === "settle-first" || op === "settle-second") {
      const { harness } = await this.host.open()
      await harness.abortTask(this.futureIds[op === "settle-first" ? 0 : 1]!, BACKGROUND_CONTEXT)
    }
    if (op === "erase-retained") {
      const { harness, root } = await this.host.open()
      await this.erase()
      const commitRejected = await harness.commit(
        (tx) => tx.appendEntry(root.id, { kind: "test.after-erase", data: {} }),
        BACKGROUND_CONTEXT,
      ).then(() => false, () => true)
      return Response.json({ commitRejected })
    }
    if (op === "storage-failure") {
      await this.ctx.storage.put("mode", "normal")
      const { harness, root } = await this.host.open()
      this.ctx.storage.sql.exec("CREATE TRIGGER fail_journal BEFORE INSERT ON journal BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END")
      await root.submit({ type: "input", content: "fail storage", requestId: "storage-failure" }, BACKGROUND_CONTEXT).catch(() => {})
      await harness.closed
      await new Promise<void>(() => {})
    }
    if (op === "stop") await this.stop()
    if (op === "alarm") await this.alarm()
    if (op === "wake") return Response.json(await this.wake())
    return Response.json({
      recoveryChanges: this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recovery_changes'").toArray().length
        ? this.ctx.storage.sql.exec("SELECT kind FROM recovery_changes").toArray().map((row) => row.kind) : [],
      futureTimes: await this.ctx.storage.get("future-times"),
      waited: this.waited,
      epoch: this.host.epoch(),
      journalRows: this.ctx.storage.sql.exec("SELECT count(*) AS n FROM journal WHERE agent = 'agent'").one().n,
      compactions: (await this.ctx.storage.get<number>("compactions")) ?? 0,
      carriedOutput: (await this.ctx.storage.get<number>("carried-output")) ?? 0,
      filled: await this.ctx.storage.get("filled"),
      instance: this.instance,
      alarmEntries: (await this.ctx.storage.get<number>("alarm-entries")) ?? 0,
      toolCalls: (await this.ctx.storage.get<number>("tool-calls")) ?? 0,
      crash: await this.ctx.storage.get("crash"),
      finished: (await this.ctx.storage.get<boolean>("finished")) ?? false,
      reply: await this.ctx.storage.get("reply"),
      alarmAt: await this.ctx.storage.getAlarm(),
      stopped: (await this.ctx.storage.get<boolean>("mid-run:stop")) ?? false,
      errors: (await this.ctx.storage.get<string[]>("errors")) ?? [],
      wakeups: this.ctx.storage.sql.exec<{ key: string; at: number }>("SELECT key, at FROM wakeups").toArray(),
    })
  }
}

export default { fetch: () => new Response("not found", { status: 404 }) }

export const T = agentObject(TService)
