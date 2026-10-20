import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { Type } from "@earendil-works/pi-ai"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"
import type { AgentSetup } from "@kiko/agent/host"
import type { Batch } from "@kiko/agent/input"
import { isAgentSlug, isRoomId, type Envelope } from "@kiko/protocol"
import { declareEffect } from "@kiko/agent/effects"
import { AgentProbe as AgentDO, agentObject } from "./agent-service"
import { userStub } from "../src/lib/names"
import { buildAgent } from "../src/agent/factory"
import type { RoomPort } from "../src/agent/outbox"
import type { RoutinesPort } from "../src/agent/extensions/routines"
import { UserDO } from "../src/user/user-do"

export { UserDO }
export class RoomDO extends DurableObject {
  async remember(seq: number, text: string) { await this.ctx.storage.put(`message:${seq}`, text) }
  async memoryView(skip: number[] = []) {
    const stored = await this.ctx.storage.list<string>({ prefix: "message:" })
    const lines = [...stored].filter(([key]) => !skip.includes(Number(key.slice(8)))).map(([key, text]) => `#${key.slice(8)} human: ${text}`)
    return { count: stored.size, text: lines.join("\n") }
  }
  async memorySince() { return { count: 0, text: "" } }
}

type MemoryAccess = {
  routineContext(): Promise<string>
  inputInvalidated(): Promise<"refresh" | "forget" | null>
  inputMemory(batch: Batch, fresh: boolean, joined: number[]): Promise<{ text?: string; fresh: boolean }>
}

class AgentProbeService extends AgentDO {
  protected override home() {
    const roomId = "01J00000000000000000000000"
    const slug = "kiko"
    if (!isRoomId(roomId) || !isAgentSlug(slug)) throw new Error("bad fixture")
    return { userId: "alice", roomId, slug }
  }
  protected override roomPort(): RoomPort {
    return { post: async () => {}, draft: async () => {}, note: async () => {}, status: async () => {}, workers: async () => {}, endRun: async () => {}, react: async () => {} }
  }
  protected override async setup(): Promise<AgentSetup> {
    const faux = fauxProvider()
    const models = createModels()
    models.setProvider(faux.provider)
    const wait = declareEffect("read", defineTool({
      name: "wait_memory", description: "wait for the human", parameters: Type.Object({}), replay: "safe",
      execute: async (_args, _api, context) => {
        await this.ctx.storage.put("waiting", true)
        await new Promise<void>((_resolve, reject) => {
          context.abortSignal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
        })
        return { output: [] }
      },
    }))
    faux.setResponses(Array.from({ length: 100 }, () => (request: { messages: readonly unknown[] }) => {
      const input = JSON.stringify(request.messages)
      void this.ctx.storage.put({ "model-input": input, "latest-input": JSON.stringify(request.messages.at(-1)) })
      const last = request.messages.at(-1)
      if (typeof last === "object" && last !== null && "role" in last && last.role === "toolResult") return fauxAssistantMessage("acknowledged")
      if (input.includes("RECALL")) return fauxAssistantMessage(fauxToolCall("recall_memory", {}), { stopReason: "toolUse" })
      if (input.includes("HANG")) return fauxAssistantMessage(fauxToolCall("wait_memory", {}), { stopReason: "toolUse" })
      return fauxAssistantMessage("acknowledged")
    }))
    const recall = declareEffect("read", defineTool({ name: "recall_memory", description: "recall the private code", parameters: Type.Object({}), replay: "safe", execute: async () => ({ output: [{ type: "text", text: (await userStub(this.env.USER, "alice").lifeRecall("ORCHID")).join("\n") }] }) }))
    const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, testExtensions: [defineExtension({ name: "memory-probe", tools: [wait, recall] })] })
    const memory = this as unknown as MemoryAccess
    return { models, ...built, beginRun: async () => true, inputContext: () => memory.routineContext(), inputMemory: (batch, fresh, joined) => memory.inputMemory(batch, fresh, joined), inputInvalidated: () => memory.inputInvalidated() }
  }
  override async fetch(request: Request) {
    const body = await request.json<{ op: "input" | "latest" | "waiting" | "status" | "turn" | "routines" | "update" | "cancel"; text?: string; n?: number; wait?: boolean; id?: string; patch?: Parameters<RoutinesPort["updateRoutine"]>[1] }>()
    if (body.op === "routines" || body.op === "update" || body.op === "cancel") {
      const port = (this as unknown as { routinesPort(): RoutinesPort }).routinesPort()
      if (body.op === "routines") return Response.json(await port.list())
      if (!body.id) throw new Error("id required")
      return Response.json(body.op === "cancel" ? await port.cancel(body.id) : await port.updateRoutine(body.id, body.patch ?? {}))
    }
    if (body.op === "status") return Response.json(await this.host.status())
    if (body.op === "latest") return Response.json(await this.ctx.storage.get("latest-input"))
    if (body.op === "input") return Response.json(await this.ctx.storage.get("model-input"))
    if (body.op === "waiting") return Response.json(await this.ctx.storage.get("waiting") ?? false)
    const envelope: Envelope = { id: `human:m${body.n}`, roomId: this.home().roomId, from: { kind: "human" }, body: body.text ?? "hi", hop: 0, rootId: `m${body.n}`, seq: body.n ?? 1 }
    await this.receive([envelope], "")
    await this.alarm()
    if (body.wait !== false) {
      const opened = await this.host.open()
      await opened.harness.waitForIdle(BACKGROUND_CONTEXT)
      await this.alarm()
    }
    return Response.json(true)
  }
}
export class RadarProbe extends AgentProbe {
  protected override home() {
    const slug = "radar"
    if (!isAgentSlug(slug)) throw new Error("bad fixture")
    return { ...super.home(), slug }
  }
}
export class WriterProbe extends AgentProbe {
  protected override home() {
    const slug = "writer"
    if (!isAgentSlug(slug)) throw new Error("bad fixture")
    return { ...super.home(), slug }
  }
}
export default { fetch(request: Request, env: { USER: DurableObjectNamespace<UserDO> }) {
  return env.USER.get(env.USER.idFromName("user:alice")).fetch(request)
} }

export const AgentProbe = agentObject(AgentProbeService)
