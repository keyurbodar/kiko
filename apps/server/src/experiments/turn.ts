import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { AssistantEntry, createRegistry, Harness, LiveDoc, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { userModels } from "../agent/factory"
import { openDurableObjectSqlite } from "@yuki/agent/sqlite"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { createAlarms } from "@yuki/durable/alarm"
import { userStub } from "../lib/names"
import { countRows, type RowCounts } from "./count-rows"

const context = BACKGROUND_CONTEXT
const MODEL = { provider: "opencode-go", modelId: "deepseek-v4.1-flash" }
const PROMPT = "write the numbers from one to three hundred in english words, comma separated, nothing else."
const HEARTBEAT = "experiment-heartbeat"
const HEARTBEAT_MS = 5_000
const USER_KEY = "experiment:user"

type AssistantMessage = { content?: { type: string; text?: string }[]; stopReason?: string }
const text = (message: AssistantMessage | undefined) =>
  (message?.content ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("")

export async function experimentTurnRoute(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env)
  if (!user) return new Response("sign in first", { status: 401 })
  const name = new URL(request.url).searchParams.get("name")
  // check-rules: allow do-names dev experiment route, removed with apps/server/src/experiments
  const stub = env.AGENT.get(env.AGENT.idFromName(name ? `experiment:turn:${name}` : "experiment:turn"))
  if (request.method === "GET") return Response.json(await stub.experimentStatus())
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 })
  const requestId = new URL(request.url).searchParams.get("id") ?? "turn-1"
  return Response.json(await stub.experimentTurn(requestId, new URL(request.url).searchParams.get("heartbeat") !== "0", user.id))
}

export class TurnExperiment {
  private harness?: Promise<{ harness: Harness; openMs: number }>
  private readonly alarms
  private counter?: ReturnType<typeof countRows>

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.alarms = createAlarms(ctx)
  }

  private open() {
    this.harness ??= (async () => {
      const started = performance.now()
      const { models, settings } = userModels(async (provider) => {
        const userId = await this.ctx.storage.get<string>(USER_KEY)
        return userId ? ((await userStub(this.env.USER, userId).turnContext(provider)).auth ?? undefined) : undefined
      }, this.ctx.id.toString())
      this.counter = (this.env as { YUKI_DEBUG_ROWS?: string }).YUKI_DEBUG_ROWS === "1" ? countRows(this.ctx.storage) : undefined
      const storage = await SqliteStorage.open(openDurableObjectSqlite(this.counter?.storage ?? this.ctx.storage))
      const harness = await Harness.open(storage, { models, registry: createRegistry(), settings }, context)
      return { harness, openMs: Math.round(performance.now() - started) }
    })()
    return this.harness
  }

  private async log(event: string) {
    const events = ((await this.ctx.storage.get<string[]>("experiment:events")) ?? []).concat(`${new Date().toISOString()} ${event}`)
    await this.ctx.storage.put("experiment:events", events)
  }

  async turn(requestId: string, heartbeat: boolean, userId: string) {
    const wallStarted = performance.now()
    await this.ctx.storage.put(USER_KEY, userId)
    const { harness, openMs } = await this.open()
    const afterOpen = this.counter?.snapshot()
    await this.log(`request ${requestId} (open ${openMs} ms)`)
    if (heartbeat) await this.alarms.setWakeup(HEARTBEAT, Date.now() + HEARTBEAT_MS)
    const root = await harness.root(context, { agent: { model: MODEL } })
    const submission = await root.submit({ type: "input", content: PROMPT, requestId }, context)
    const settled = await submission.wait(context)
    if (heartbeat) await this.alarms.clearWakeup(HEARTBEAT)
    const failure = settled.status === "unanswered" ? ` ${settled.reason} ${JSON.stringify(settled.detail ?? null)}` : ""
    await this.log(`request ${requestId} settled ${settled.status}${failure}`)
    const wallMs = Math.round(performance.now() - wallStarted)
    const end = this.counter?.snapshot()
    const rows =
      end && afterOpen
        ? {
            open: afterOpen,
            turn: { rowsRead: end.rowsRead - afterOpen.rowsRead, rowsWritten: end.rowsWritten - afterOpen.rowsWritten, statements: end.statements - afterOpen.statements } satisfies RowCounts,
          }
        : undefined
    return { ...(await this.report(harness)), status: settled.status, openMs, wallMs, rows, objectId: this.ctx.id.toString() }
  }

  async alarm() {
    if (!(await this.alarms.dueWakeups(Date.now())).includes(HEARTBEAT)) return
    const { harness, openMs } = await this.open()
    const before = await harness.inspect(context)
    if (before.tasks.length === 0) return
    await this.log(`alarm resumes ${before.tasks.length} tasks (open ${openMs} ms)`)
    await this.alarms.setWakeup(HEARTBEAT, Date.now() + HEARTBEAT_MS)
    harness.resume()
    await harness.waitForIdle(context)
    await this.alarms.clearWakeup(HEARTBEAT)
    await this.log("alarm finished the run")
  }

  async status() {
    const { harness, openMs } = await this.open()
    const live = await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context)
    const inspection = await harness.inspect(context)
    return {
      openMs,
      tasks: inspection.tasks.map((task) => `${task.record.kind}:${task.state.kind}`),
      partialChars: text(live?.generation?.message as AssistantMessage | undefined).length,
      events: (await this.ctx.storage.get<string[]>("experiment:events")) ?? [],
    }
  }

  private async report(harness: Harness) {
    const root = await harness.root(context)
    const view = await root.context(context)
    const assistants = view.entries.filter((entry) => entry.kind === AssistantEntry.kind)
    const last = assistants.at(-1)?.model?.[0] as AssistantMessage | undefined
    return {
      answer: text(last),
      aborted: assistants.filter((entry) => (entry.model?.[0] as AssistantMessage | undefined)?.stopReason === "aborted").length,
      events: (await this.ctx.storage.get<string[]>("experiment:events")) ?? [],
    }
  }
}
