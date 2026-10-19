import { DurableObject } from "cloudflare:workers"
import type { Batch } from "@kiko/agent/inbox"
import { AgentDO } from "../src/agent/agent-do"
import { isAgentSlug, isRoomId } from "@kiko/protocol"

export class UserDO extends DurableObject {
  async lifeView(): Promise<string> {
    return (await this.ctx.storage.get<string>("life")) ?? ""
  }
  async lifeRevision(): Promise<number> { return (await this.ctx.storage.get<number>("revision")) ?? 0 }
  async lifeState() { return { revision: await this.lifeRevision(), text: await this.lifeView() } }
  async setLife(text: string): Promise<void> {
    await this.ctx.storage.put({ life: text, revision: (await this.lifeRevision()) + 1 })
  }
}

export class RoomDO extends DurableObject {
  async memoryView() { return { count: 1, text: "#0 human: hello" } }
  async memorySince() { return { count: 1, text: "" } }
}

export class AgentProbe extends AgentDO {
  protected override home() {
    const roomId = "01J00000000000000000000000"
    const slug = "kiko"
    if (!isRoomId(roomId) || !isAgentSlug(slug)) throw new Error("invalid fixture")
    return { userId: "alice", roomId, slug }
  }
  override async fetch(request: Request) {
    const body = await request.json<{ fresh: boolean; withLife?: boolean }>()
    const probe = this as unknown as { inputMemory(batch: Batch, fresh: boolean, joined: number[], withLife?: boolean): Promise<unknown> }
    return Response.json(await probe.inputMemory({ requestId: crypto.randomUUID(), envelopes: [], briefs: [] }, body.fresh, [], body.withLife))
  }
}

export default { fetch() { return new Response("ok") } }
