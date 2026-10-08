// Experiment 1 (architecture section 21). A throwaway route that runs one pi-durable turn inside
// AgentDO and recovers it after the process dies. Delete it once AgentDO has its real host.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { AssistantEntry, createRegistry, Harness, LiveDoc, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { userModels } from "../agent/factory"
import { openDurableObjectSqlite } from "../agent/sqlite"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { createAlarms } from "@kiko/durable/alarm"
import { userStub } from "../lib/names"
import { countRows, type RowCounts } from "./count-rows"

const context = BACKGROUND_CONTEXT
const MODEL = { provider: "opencode-go", modelId: "deepseek-v4.1-flash" }
const PROMPT = "write the numbers from one to three hundred in english words, comma separated, nothing else."
const HEARTBEAT = "experiment-heartbeat"
const HEARTBEAT_MS = 5_000
/** The user whose credential the experiment's model calls use. */
const USER_KEY = "experiment:user"

type AssistantMessage = { content?: { type: string; text?: string }[]; stopReason?: string }
const text = (message: AssistantMessage | undefined) =>
  (message?.content ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("")

/** The Worker side: one fixed Durable Object, named here and nowhere else. */
export async function experimentTurnRoute(request: Request, env: Env): Promise<Response> {
  // The model call uses the signed-in user's own `opencode-go` credential (P4-02).
  const user = await getSessionUser(request, env)
  if (!user) return new Response("sign in first", { status: 401 })
  // `?name=` picks a fresh object, so a measurement run starts from an empty database.
  const name = new URL(request.url).searchParams.get("name")
  const stub = env.AGENT.get(env.AGENT.idFromName(name ? `experiment:turn:${name}` : "experiment:turn"))
  if (request.method === "GET") return Response.json(await stub.experimentStatus())
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 })
  const requestId = new URL(request.url).searchParams.get("id") ?? "turn-1"
  // `?heartbeat=0` skips the heartbeat alarm, so a measurement can leave it out.
  return Response.json(await stub.experimentTurn(requestId, new URL(request.url).searchParams.get("heartbeat") !== "0", user.id))
}

/** The Durable Object side. AgentDO owns one instance and forwards to it. */
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

  // Opening applies the storage migrations and loads live tasks. The time is the cold-open cost.
  private open() {
    this.harness ??= (async () => {
      const started = performance.now()
      // The auth comes from the user who asked for the turn, through `UserDO.turnContext`, and stays in memory.
      // WORKAROUND inside: OpenCode Go rejects a request without `x-opencode-session` (400 MissingSessionID).
      const { models, settings } = userModels(async (provider) => {
        const userId = await this.ctx.storage.get<string>(USER_KEY)
        return userId ? ((await userStub(this.env.USER, userId).turnContext(provider)).auth ?? undefined) : undefined
      }, this.ctx.id.toString())
      // Experiment 2: count rows behind a debug flag.
      this.counter = (this.env as { KIKO_DEBUG_ROWS?: string }).KIKO_DEBUG_ROWS === "1" ? countRows(this.ctx.storage) : undefined
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
    // `open` is the one-time migration and load. `turn` is everything after it.
    const rows =
      end && afterOpen
        ? {
            open: afterOpen,
            turn: { rowsRead: end.rowsRead - afterOpen.rowsRead, rowsWritten: end.rowsWritten - afterOpen.rowsWritten, statements: end.statements - afterOpen.statements } satisfies RowCounts,
          }
        : undefined
    return { ...(await this.report(harness)), status: settled.status, openMs, wallMs, rows, objectId: this.ctx.id.toString() }
  }

  // The heartbeat. After a restart this is what wakes the object and finishes the run.
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
      // An aborted assistant entry is the partial that recovery converted after the process died.
      aborted: assistants.filter((entry) => (entry.model?.[0] as AssistantMessage | undefined)?.stopReason === "aborted").length,
      events: (await this.ctx.storage.get<string[]>("experiment:events")) ?? [],
    }
  }
}
