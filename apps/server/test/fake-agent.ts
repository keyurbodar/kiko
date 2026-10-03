import { DurableObject } from "cloudflare:workers"
import type { Agent, AgentSlug, AgentState, Chat, Envelope } from "@kiko/protocol"
import { agentName, ROOM_ID_HEADER, roomStub, USER_ID_HEADER } from "../src/lib/names"
import type { AgentHome, RoomDO } from "../src/room/room-do"

// P6-01. Runs inside workerd; `team-routing.test.ts` drives it through Miniflare. The real `RoomDO`
// with two stand-ins: `FakeAgent` records every `receive()` and `stop()` and runs no model, so a test
// sees exactly who was woken and with which brief, and `FakeUser` answers the two `UserDO` calls the
// room makes. The live counterpart for `bun kiko verify team-routing` is `src/agent/dev-fake.ts`.

export { RoomDO } from "../src/room/room-do"

export type Received = { envelopes: Envelope[]; brief: string; home: AgentHome | null }

export class FakeAgent extends DurableObject {
  private log(): { received: Received[]; stops: number } {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS calls (n INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL)")
    const rows = this.ctx.storage.sql.exec<{ kind: string; body: string }>("SELECT kind, body FROM calls ORDER BY n").toArray()
    return {
      received: rows.filter((r) => r.kind === "receive").map((r) => JSON.parse(r.body) as Received),
      stops: rows.filter((r) => r.kind === "stop").length,
    }
  }

  /** The next `n` receives throw, as a transient failure between objects would. */
  async failNext(n: number) {
    await this.ctx.storage.put("fail", n)
  }

  async receive(envelopes: Envelope[], brief: string, home?: AgentHome) {
    this.log()
    const fail = (await this.ctx.storage.get<number>("fail")) ?? 0
    if (fail > 0) {
      await this.ctx.storage.put("fail", fail - 1)
      throw new Error("network connection lost")
    }
    this.ctx.storage.sql.exec("INSERT INTO calls (kind, body) VALUES ('receive', ?)", JSON.stringify({ envelopes, brief, home: home ?? null }))
    return { admitted: envelopes.map((e) => e.id) }
  }

  async stop() {
    this.log()
    this.ctx.storage.sql.exec("INSERT INTO calls (kind, body) VALUES ('stop', '{}')")
    return { discarded: 0 }
  }

  async calls() {
    return this.log()
  }
}

type UserState = { chats: Chat[]; agents: Agent[] }

export class FakeUser extends DurableObject {
  async set(state: UserState) {
    await this.ctx.storage.put("state", state)
  }
  private async state(): Promise<UserState> {
    return (await this.ctx.storage.get<UserState>("state")) ?? { chats: [], agents: [] }
  }
  async listChats() {
    return (await this.state()).chats
  }
  async getChat(roomId: string) {
    return (await this.state()).chats.find((c) => c.roomId === roomId) ?? null
  }
  async listAgents() {
    return (await this.state()).agents
  }
  /** Limits are not under test here: every burst gets its turn. */
  async takeTurn() {
    const used = ((await this.ctx.storage.get<number>("turns")) ?? 0) + 1
    await this.ctx.storage.put("turns", used)
    return { ok: true as const, used }
  }
  async turns() {
    return (await this.ctx.storage.get<number>("turns")) ?? 0
  }
  /** A run ended. The chat list's touch is not under test here. */
  async touchChat() {}
  /** The room reads one chat row, not the whole list. */
  async getChat(roomId: string) {
    return (await this.state()).chats.find((c) => c.roomId === roomId) ?? null
  }
}

type Env = { ROOM: DurableObjectNamespace<RoomDO>; AGENT: DurableObjectNamespace<FakeAgent>; USER: DurableObjectNamespace<FakeUser> }

const ALICE = "alice"

// `/ws/<roomId>`                    the room socket as alice
// `POST /user` UserState            what alice's chat list and agent list hold
// `/calls/<roomId>/<slug>`          what the fake agent received
// `/status/<roomId>/<slug>/<state>` an agent reports its state
// `/inventory/<roomId>`             the room's inventory for account deletion
// `/post/<roomId>/<slug>`           the agent posts one bubble
// `/end/<roomId>/<slug>/<runId>`    the agent's run ends
// `/fail/<roomId>/<slug>/<n>`       the agent's next n receives throw
// `/turns`                          the turns alice has taken
// `POST /mail/<roomId>/<slug>`      the agent sends an agent message (AgentSend)
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, roomId, slug, state] = new URL(request.url).pathname.split("/")
    if (kind === "user") {
      await env.USER.get(env.USER.idFromName(`user:${ALICE}`)).set((await request.json()) as UserState)
      return Response.json({ ok: true })
    }
    const user = env.USER.get(env.USER.idFromName(`user:${ALICE}`))
    if (kind === "turns") return Response.json({ turns: await user.turns() })
    const room = roomStub(env.ROOM, ALICE, roomId!)
    if (kind === "fail") {
      await env.AGENT.get(env.AGENT.idFromName(agentName(ALICE, roomId!, slug!))).failNext(Number(state))
      return Response.json({ ok: true })
    }
    if (kind === "mail") return Response.json(await room.agentMessage(slug as AgentSlug, (await request.json()) as never))
    if (kind === "calls") return Response.json(await env.AGENT.get(env.AGENT.idFromName(agentName(ALICE, roomId!, slug!))).calls())
    if (kind === "status") {
      await room.setStatus(slug as AgentSlug, state as AgentState)
      return Response.json({ ok: true })
    }
    if (kind === "inventory") return Response.json(await room.inventory())
    if (kind === "end") {
      await room.endRun(slug as AgentSlug, state!)
      return Response.json({ ok: true })
    }
    if (kind === "post") return Response.json(await room.post(slug as AgentSlug, `${slug}:r1`, 0, 0, "i can help"))
    const headers = new Headers(request.headers)
    headers.set(USER_ID_HEADER, ALICE)
    headers.set(ROOM_ID_HEADER, roomId!)
    return room.fetch(new Request(request, { headers }))
  },
}
