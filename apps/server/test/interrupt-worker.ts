import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import type { AgentSetup, HostOptions } from "@yuki/agent/host"
import type { Envelope } from "@yuki/protocol"
import { AgentDO } from "../src/agent/agent-do"
import { buildAgent } from "../src/agent/factory"

const context = BACKGROUND_CONTEXT

type Msg = { role: string; content?: string | { type: string; text?: string }[] }
const textOf = (m: Msg | undefined) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join(""))
const bare = (text: string) => text.replace(/<context>[\s\S]*?<\/context>\s*/g, "").trim()

const gates = new Map<string, Set<() => void>>()

type Body =
  | { op: "receive"; envelopes: Envelope[] }
  | { op: "wait" }
  | { op: "answer"; text: string }
  | { op: "release" }
  | { op: "counts" }
  | { op: "posts" }

// A read that waits until released or aborted, and a write that waits until released. Each counts its starts and ends.
export class I extends AgentDO {
  protected override readonly hostOptions: Partial<HostOptions> = { heartbeatMs: 500 }

  private get waiters(): Set<() => void> {
    const id = this.ctx.id.toString()
    if (!gates.has(id)) gates.set(id, new Set())
    return gates.get(id)!
  }

  private async bump(key: string): Promise<void> {
    await this.ctx.storage.put(key, ((await this.ctx.storage.get<number>(key)) ?? 0) + 1)
  }

  private async pause(name: string, abortable: boolean, ctx: { abortSignal?: AbortSignal }): Promise<{ content: { type: "text"; text: string }[] }> {
    await this.bump(`${name}:started`)
    await new Promise<void>((resolve, reject) => {
      this.waiters.add(resolve)
      if (abortable) {
        ctx.abortSignal?.addEventListener(
          "abort",
          () => {
            this.waiters.delete(resolve)
            void this.bump(`${name}:aborted`).then(() => reject(ctx.abortSignal?.reason ?? new Error("aborted")))
          },
          { once: true },
        )
      }
    })
    await this.bump(`${name}:finished`)
    return { content: [{ type: "text", text: "released" }] }
  }

  protected override async setup(): Promise<AgentSetup> {
    const read = declareEffect(
      "read",
      defineTool({
        name: "hang",
        description: "waits until the test releases it.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async (_args, _api, ctx) => this.pause("hang", true, ctx),
      }),
    )
    const write = declareEffect(
      "write",
      defineTool({
        name: "hold",
        description: "writes once the test releases it.",
        parameters: Type.Object({}),
        replay: "unsafe",
        execute: async (_args, _api, ctx) => this.pause("hold", false, ctx),
      }),
    )
    const step = (request: { messages: readonly unknown[] }) => {
      const messages = (request.messages as Msg[]).filter((m) => m.role !== "system")
      const last = messages.at(-1)
      if (last?.role === "toolResult") {
        const results = messages.slice(messages.findLastIndex((m) => m.role === "assistant") + 1).map(textOf)
        return fauxAssistantMessage(`tools said: ${results.join(" || ")}`)
      }
      const turn = bare(textOf(last))
      if (turn.includes("HANG")) return fauxAssistantMessage(fauxToolCall("hang", {}), { stopReason: "toolUse" })
      if (turn.includes("HOLD")) return fauxAssistantMessage(fauxToolCall("hold", {}), { stopReason: "toolUse" })
      return fauxAssistantMessage(`reply to: ${turn}`)
    }
    const faux = fauxProvider()
    faux.setResponses(Array.from({ length: 200 }, () => step))
    const models = createModels()
    models.setProvider(faux.provider)
    const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, testExtensions: [defineExtension({ name: "test-interrupt", tools: [read, write] })] })
    return { models, ...built, beginRun: async () => true }
  }

  override async fetch(request: Request) {
    const body = (await request.json()) as Body
    if (body.op === "receive") return Response.json(await this.receive(body.envelopes, ""))
    if (body.op === "wait") return Response.json(await this.answers.wait("ask", 5_000))
    if (body.op === "answer") {
      this.answers.answer("ask", body.text)
      return Response.json({ ok: true })
    }
    if (body.op === "release") {
      for (const resolve of this.waiters) resolve()
      this.waiters.clear()
      return Response.json({ ok: true })
    }
    if (body.op === "counts") {
      const get = async (key: string) => (await this.ctx.storage.get<number>(key)) ?? 0
      return Response.json({
        hangStarted: await get("hang:started"),
        hangAborted: await get("hang:aborted"),
        holdStarted: await get("hold:started"),
        holdFinished: await get("hold:finished"),
      })
    }
    const { root } = await this.host.open()
    const view = await root.context(context)
    const posts = view.entries.filter((e) => e.kind === "pi.assistant").map((e) => textOf(e.model?.[0] as Msg | undefined))
    return Response.json(posts)
  }
}

export default {
  async fetch() {
    return new Response("not found", { status: 404 })
  },
}
