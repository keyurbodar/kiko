import type { Batch } from "@kiko/agent/input"
import { AgentProbe } from "./agent-service"
import { OwnerDO } from "../src/owner/owner-do"

const ROOM = "01J00000000000000000000000"
class MemoryProbe extends AgentProbe {
  protected override home() { return { userId: "alice", roomId: ROOM as never, slug: "kiko" as never } }
  async input(fresh: boolean, withLife: boolean): Promise<unknown> {
    const probe = this as unknown as { inputMemory(batch: Batch, fresh: boolean, joined: number[], withLife: boolean): Promise<unknown> }
    return probe.inputMemory({ requestId: crypto.randomUUID(), envelopes: [], briefs: [] }, fresh, [], withLife)
  }
}
export class RefreshOwner extends OwnerDO {
  private revision = 0
  private life = ""
  private readonly probe: MemoryProbe
  constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof OwnerDO>[1]) {
    super(ctx, env)
    this.user().lifeState = async () => ({ revision: this.revision, forgotten: 0, text: this.life })
    this.room(ROOM).memoryView = async () => ({ count: 1, text: "#0 human: hello" })
    this.room(ROOM).memorySince = async () => ({ count: 1, text: "" })
    this.probe = new MemoryProbe(ctx, env, { services: this.services, identity: { ownerId: "alice", roomId: ROOM, slug: "kiko" } })
  }
  async setLife(text: string) { this.life = text; this.revision++ }
  async input(fresh: boolean, withLife: boolean) { return this.probe.input(fresh, withLife) }
}
export default { fetch() { return new Response("ok") } }
