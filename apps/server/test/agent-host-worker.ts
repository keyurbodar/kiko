import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import type { Envelope } from "@kiko/protocol"
import { AgentDO } from "../src/agent/agent-do"
import { buildAgent } from "../src/agent/factory"
import type { AgentSetup, HostOptions } from "../src/agent/host"
import { LONG_ANSWER, SLOW } from "./agent-host-fixtures"

// Runs inside workerd. `agent-host.test.ts` drives it through Miniflare. `T` is the real `AgentDO`
// with the faux model in place of the dev setup, so no test spends a token.

const context = BACKGROUND_CONTEXT

type Message = { role?: string; content?: string | { type: string; text?: string }[]; stopReason?: string }
const textOf = (message: Message | undefined) =>
  typeof message?.content === "string"
    ? message.content
    : (message?.content ?? []).map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("")

type Body =
  | { op: "receive"; envelopes: Envelope[]; brief?: string }
  | { op: "status" }
  | { op: "transcript" }
  | { op: "fail-open" }
  | { op: "crash" }

export class T extends AgentDO {
  protected override readonly hostOptions: Partial<HostOptions> = {
    heartbeatMs: 500,
    onOpen: async () => {
      await this.ctx.storage.put("opens", ((await this.ctx.storage.get<number>("opens")) ?? 0) + 1)
    },
    onGiveUp: async () => {
      await this.ctx.storage.put("gave-up", ((await this.ctx.storage.get<number>("gave-up")) ?? 0) + 1)
    },
  }

  protected override async setup(): Promise<AgentSetup> {
    if (await this.ctx.storage.get("fail-open")) {
      await this.ctx.storage.delete("fail-open")
      throw new Error("setup failed on purpose")
    }
    const faux = fauxProvider({ tokensPerSecond: 50 })
    const answer = (_context: unknown) => {
      const messages = (_context as { messages: Message[] }).messages
      const last = textOf(messages.filter((m) => m.role === "user").at(-1))
      return fauxAssistantMessage(last.includes(SLOW) ? LONG_ANSWER : "ok")
    }
    faux.setResponses(Array.from({ length: 20 }, () => answer))
    const models = createModels()
    models.setProvider(faux.provider)
    return { models, ...buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" } }) }
  }

  override async fetch(request: Request) {
    const body = (await request.json()) as Body
    if (body.op === "receive") return Response.json(await this.receive(body.envelopes, body.brief ?? ""))
    if (body.op === "status") return Response.json({ ...(await this.status()), opens: (await this.ctx.storage.get<number>("opens")) ?? 0, gaveUp: (await this.ctx.storage.get<number>("gave-up")) ?? 0 })
    if (body.op === "fail-open") {
      await this.ctx.storage.put("fail-open", true)
      return Response.json({ ok: true })
    }
    if (body.op === "crash") {
      // Everything committed so far is durable, then the process dies mid-run.
      await this.ctx.storage.sync()
      this.ctx.abort("simulated crash")
      return Response.json({ error: "still alive" }, { status: 500 })
    }
    const { root } = await this.host.open()
    const view = await root.context(context)
    const messages = (kind: string) => view.entries.filter((e) => e.kind === kind).map((e) => e.model?.[0] as Message | undefined)
    return Response.json({
      users: messages("pi.user").map(textOf),
      assistants: messages("pi.assistant").map((m) => ({ text: textOf(m), stopReason: m?.stopReason })),
    })
  }
}

export default {
  async fetch() {
    return new Response("not found", { status: 404 })
  },
}
