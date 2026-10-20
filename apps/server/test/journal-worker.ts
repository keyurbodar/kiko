import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { AssistantEntry, createRegistry, defineExtension, defineTool, Harness, LiveDoc, ROOT_CONVERSATION_ID, type StorageWrite } from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import { JournalStorage, JOURNAL_STEPS } from "@kiko/agent/journal"
import { assertions as a } from "./journal-assertions"

const context = BACKGROUND_CONTEXT
const model = { provider: "faux", modelId: "faux-1" }
type Body = { op: "crash" | "resume" }

export class T extends DurableObject {
  private readonly instance = crypto.randomUUID()

  async fetch(request: Request): Promise<Response> {
    const body: Body = await request.json()
    for (const step of JOURNAL_STEPS) {
      if (typeof step === "string") this.ctx.storage.sql.exec(step)
      else step(this.ctx.storage.sql)
    }
    try {
      return await (body.op === "crash" ? this.crash() : this.resume())
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.stack : String(error) })
    }
  }

  private async toolHarness(crash: boolean) {
    const entered = Promise.withResolvers<void>()
    const storage = this.ctx.storage
    storage.sql.exec("CREATE TABLE IF NOT EXISTS calls (tool TEXT PRIMARY KEY, count INTEGER NOT NULL) STRICT")
    const count = (tool: string) => storage.sql.exec("INSERT INTO calls VALUES (?, 1) ON CONFLICT(tool) DO UPDATE SET count = count + 1 RETURNING count", tool).one().count
    const extension = defineExtension({ name: "journal-test", tools: [
      declareEffect("write", defineTool({ name: "save", description: "Save a receipt", parameters: Type.Object({}), replay: "safe", execute: async (_args, api, ctx) => {
        count("save")
        await api.commit((tx) => tx.appendEntry(api.conversationId, { kind: "test.saved", data: { receipt: "saved once" } }), ctx)
        return { output: [{ type: "text", text: "saved once" }] }
      } })),
      declareEffect("read", defineTool({ name: "wait", description: "Wait across eviction", parameters: Type.Object({}), replay: "safe", execute: async () => {
        count("wait")
        if (crash) { entered.resolve(); await new Promise<void>(() => {}) }
        return { output: [{ type: "text", text: "continued" }] }
      } })),
    ] })
    const registry = createRegistry()
    registry.install(extension)
    const faux = fauxProvider()
    faux.setResponses(crash ? [
      fauxAssistantMessage(fauxToolCall("save", {}, { id: "save-call" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("wait", {}, { id: "wait-call" }), { stopReason: "toolUse" }),
    ] : [(request) => {
      const messages = JSON.stringify(request.messages)
      for (const text of ["saved once", "remember my request", "continued"]) a.ok(messages.includes(text))
      return fauxAssistantMessage("Finished with saved work intact.")
    }])
    const models = createModels()
    models.setProvider(faux.provider)
    const journal = JournalStorage.open(storage, "agent")
    // Opening the Harness recovers running tools as pending; compare replay before that transition.
    const replayedTasks = await journal.scanTasks({}, 100, undefined, context)
    const harness = await Harness.open(journal, { models, registry }, context)
    return { harness, journal, extension, entered, replayedTasks }
  }

  private async crash(): Promise<Response> {
    const { harness, journal, extension, entered } = await this.toolHarness(true)
    const root = await harness.root(context, { agent: { model, extensions: [extension] } })
    const submission = await root.submit({ type: "input", content: "remember my request", requestId: "stable-input" }, context)
    await entered.promise
    a.strictEqual(this.ctx.storage.sql.exec("SELECT count FROM calls WHERE tool = 'save'").one().count, 1)
    const inspection = await harness.inspect(context)
    a.ok(inspection.tasks.length > 0)
    const writes = this.ctx.storage.sql.exec<{ data: string }>("SELECT CAST(data AS TEXT) AS data FROM journal WHERE agent = 'agent' ORDER BY seq, part").toArray()
      .flatMap((row) => (JSON.parse(row.data) as { writes: StorageWrite[] }).writes)
    const committedIds = writes.map((write) => {
      if (write.type === "document.create" || write.type === "document.copy") return write.record.id
      if (write.type === "document.change" || write.type === "document.retire") return write.id
      return write.value.id
    })
    await this.ctx.storage.put("checkpoint", {
      submissionId: submission.id,
      saved: (await root.context(context)).entries.filter((entry) => entry.kind === "test.saved"),
      tasks: await journal.scanTasks({}, 100, undefined, context),
      live: await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context),
      submissions: inspection.submissions,
      taskIds: inspection.tasks.map((task) => task.record.id).sort(),
      maxId: Math.max(...committedIds),
    })
    await this.ctx.storage.put("aborted-instance", this.instance)
    await this.ctx.storage.sync()
    this.ctx.abort("journal test eviction during second tool")
    return Response.json({ ok: false, error: "abort returned" })
  }

  private async resume(): Promise<Response> {
    const previous = await this.ctx.storage.get("aborted-instance")
    a.ok(previous !== this.instance, "expected a new Durable Object instance")
    const checkpoint = (await this.ctx.storage.get<{
      submissionId: Parameters<Harness["submission"]>[0]
      saved: unknown
      tasks: Awaited<ReturnType<JournalStorage["scanTasks"]>>
      live: unknown
      submissions: unknown
      taskIds: number[]
      maxId: number
    }>("checkpoint"))!
    const { harness, journal, replayedTasks } = await this.toolHarness(false)
    a.ok(await journal.mintId() > checkpoint.maxId)
    a.deepEqual(replayedTasks, checkpoint.tasks)
    a.deepEqual(await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context), checkpoint.live)
    const recovered = await harness.inspect(context)
    a.deepEqual(recovered.submissions, checkpoint.submissions)
    a.deepEqual(recovered.tasks.map((task) => task.record.id).sort(), checkpoint.taskIds)
    harness.resume()
    const submission = await harness.submission(checkpoint.submissionId, context)
    a.ok(submission)
    a.strictEqual((await submission.wait(context)).status, "done")
    await harness.waitForIdle(context)
    const view = await (await harness.root(context)).context(context)
    a.strictEqual(view.entries.filter((entry) => entry.kind === "test.saved").length, 1)
    a.deepEqual(view.entries.filter((entry) => entry.kind === "test.saved"), checkpoint.saved)
    a.ok(JSON.stringify(view.entries.filter((entry) => entry.kind === AssistantEntry.kind)).includes("Finished with saved work intact."))
    a.strictEqual((await harness.inspect(context)).tasks.length, 0)
    const calls = this.ctx.storage.sql.exec("SELECT tool, count FROM calls ORDER BY tool").toArray()
    a.deepEqual(calls, [{ tool: "save", count: 1 }, { tool: "wait", count: 2 }])
    a.strictEqual((await journal.submissionByRequest(ROOT_CONVERSATION_ID, "stable-input", context))?.id, checkpoint.submissionId)
    await harness.close(context)
    return Response.json({ ok: true, calls, newInstance: previous !== this.instance })
  }
}

export default { fetch: () => new Response("not found", { status: 404 }) }
