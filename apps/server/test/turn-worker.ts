import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import type { AgentSlug, AgentState, Envelope, RoomId } from "@kiko/protocol"
import { AgentDO } from "../src/agent/agent-do"
import { buildAgent } from "../src/agent/factory"
import type { AgentSetup, HostOptions } from "../src/agent/host"
import type { RoomPort } from "../src/agent/outbox"
import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import type { RoomDO } from "../src/room/room-do"

// Runs inside workerd. `turn.test.ts` drives it through Miniflare. `T` is the real `AgentDO` with a
// faux model and a recording room port, so no test spends a token. `/room/<roomId>/...` reaches the
// real `RoomDO`.

import { AFTER, BEFORE } from "./turn-fixtures"

export { RoomDO } from "../src/room/room-do"

type Env = { ROOM: DurableObjectNamespace<RoomDO>; T: DurableObjectNamespace<T> }

type Body =
  | { op: "receive"; envelopes: Envelope[] }
  | { op: "calls" }
  | { op: "crash" }

export class T extends AgentDO {
  protected override readonly hostOptions: Partial<HostOptions> = { heartbeatMs: 500 }

  protected override async setup(): Promise<AgentSetup> {
    const crashed = (await this.ctx.storage.get<boolean>("crashed")) ?? false
    const faux = fauxProvider({ tokensPerSecond: crashed ? 400 : 10 })
    faux.setResponses(Array.from({ length: 5 }, () => fauxAssistantMessage(crashed ? AFTER : BEFORE)))
    const models = createModels()
    models.setProvider(faux.provider)
    return { models, ...buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" } }) }
  }

  /** Records every room call in this object's own storage, in order. */
  protected override roomPort(): RoomPort {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS calls (n INTEGER PRIMARY KEY AUTOINCREMENT, call TEXT NOT NULL)")
    const record = async (call: unknown) => {
      this.ctx.storage.sql.exec("INSERT INTO calls (call) VALUES (?)", JSON.stringify(call))
    }
    return {
      post: (runId, attempt, index, block, tainted) => record({ t: "post", runId, attempt, index, block, tainted }),
      draft: (runId, index, text) => record({ t: "draft", runId, index, chars: text.length }),
      status: (state: AgentState) => record({ t: "status", state }),
      endRun: (runId) => record({ t: "end", runId }),
      react: (emoji, messageId) => record({ t: "react", emoji, messageId }),
    }
  }

  override async fetch(request: Request) {
    const body = (await request.json()) as Body
    if (body.op === "receive") {
      const home = { userId: "alice", roomId: "01J00000000000000000000000" as RoomId, slug: "kiko" as AgentSlug }
      return Response.json(await this.receive(body.envelopes, "room: test", home))
    }
    if (body.op === "crash") {
      await this.ctx.storage.put("crashed", true)
      await this.ctx.storage.sync()
      this.ctx.abort("simulated crash")
      return Response.json({ error: "still alive" }, { status: 500 })
    }
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS calls (n INTEGER PRIMARY KEY AUTOINCREMENT, call TEXT NOT NULL)")
    const calls = this.ctx.storage.sql.exec<{ call: string }>("SELECT call FROM calls ORDER BY n").toArray()
    return Response.json({ calls: calls.map((r) => JSON.parse(r.call)), status: await this.status() })
  }
}

type PostBody = { slug: string; runId: string; attempt: number; index: number; block: string }

export default {
  async fetch(request: Request, env: Env) {
    const [, kind, roomId, op] = new URL(request.url).pathname.split("/")
    if (kind !== "room") return new Response("not found", { status: 404 })
    const stub = env.ROOM.get(env.ROOM.idFromName(`room:alice:${roomId}`))
    if (op === "post") {
      const b = (await request.json()) as PostBody
      return Response.json(await stub.post(b.slug as AgentSlug, b.runId, b.attempt, b.index, b.block))
    }
    if (op === "end") {
      const b = (await request.json()) as PostBody
      await stub.endRun(b.slug as AgentSlug, b.runId)
      return Response.json(true)
    }
    const headers = new Headers(request.headers)
    headers.set(USER_ID_HEADER, "alice")
    headers.set(ROOM_ID_HEADER, roomId!)
    return stub.fetch(new Request(request, { headers }))
  },
}
