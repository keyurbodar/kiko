import { DurableObject } from "cloudflare:workers"
import type { Agent, AgentSlug, AgentState, Chat, Envelope } from "@yuki/protocol"
import { agentName, ROOM_ID_HEADER, roomStub, USER_ID_HEADER } from "../src/lib/names"
import type { AgentHome, RoomDO } from "../src/room/room-do"

// P6-01. Runs inside workerd; `team-routing.test.ts` drives it through Miniflare. The real `RoomDO`
// with two stand-ins: `FakeAgent` records every `receive()` and `stop()` and runs no model, so a test
// sees exactly who was woken and with which brief, and `FakeUser` answers the two `UserDO` calls the
// room makes. The live counterpart for `bun yuki verify team-routing` is `src/agent/dev-fake.ts`.

export { RoomDO } from "../src/room/room-do"

export type Received = { envelopes: Envelope[]; brief: string; home: AgentHome | null }

export class FakeAgent extends DurableObject {
  private log(): { received: Received[]; stops: number; answers: { id: string; answer: string }[]; coming: number; gone: number } {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS calls (n INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL)")
    const rows = this.ctx.storage.sql.exec<{ kind: string; body: string }>("SELECT kind, body FROM calls ORDER BY n").toArray()
    return {
      received: rows.filter((r) => r.kind === "receive").map((r) => JSON.parse(r.body) as Received),
      stops: rows.filter((r) => r.kind === "stop").length,
      answers: rows.filter((r) => r.kind === "answer").map((r) => JSON.parse(r.body) as { id: string; answer: string }),
      coming: rows.filter((r) => r.kind === "coming").length,
      gone: rows.filter((r) => r.kind === "gone").length,
    }
  }

  /** The next `n` receives throw, as a transient failure between objects would. */
  async failNext(n: number) {
    await this.ctx.storage.put("fail", n)
  }

  /** The next `n` receives are refused as too large, as an oversized inbox entry would be. */
  async refuseNext(n: number) {
    await this.ctx.storage.put("refuse", n)
  }

  async receive(envelopes: Envelope[], brief: string, home?: AgentHome) {
    this.log()
    const refuse = (await this.ctx.storage.get<number>("refuse")) ?? 0
    if (refuse > 0) {
      await this.ctx.storage.put("refuse", refuse - 1)
      return { admitted: [], refused: "too_large" as const }
    }
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

  async askAnswered(id: string, answer: string, tainted: boolean) {
    this.log()
    this.ctx.storage.sql.exec("INSERT INTO calls (kind, body) VALUES ('answer', ?)", JSON.stringify({ id, answer, tainted }))
  }

  /** The room warned that a human message for this agent is on its way (section 7.8). */
  async humanComing() {
    this.log()
    this.ctx.storage.sql.exec("INSERT INTO calls (kind, body) VALUES ('coming', '{}')")
  }

  /** The burst it warned of closed with nothing for this agent. */
  async humanGone() {
    this.log()
    this.ctx.storage.sql.exec("INSERT INTO calls (kind, body) VALUES ('gone', '{}')")
  }

  async calls() {
    return this.log()
  }
}

type UserState = { chats: Chat[]; agents: Agent[]; souls?: Record<string, string> }

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
  /** Every burst gets its turn, unless a test said the day's turns are used. */
  async takeTurn() {
    if (await this.ctx.storage.get<boolean>("refuse")) return { ok: false as const, limit: 1, resetAt: Date.now() + 3_600_000 }
    const used = ((await this.ctx.storage.get<number>("turns")) ?? 0) + 1
    await this.ctx.storage.put("turns", used)
    return { ok: true as const, used }
  }
  /** Runs nobody's message started: the user's budget is not under test here. */
  async takeAutonomous() {
    return { ok: true as const }
  }
  async refuseTurns(refuse: boolean) {
    await this.ctx.storage.put("refuse", refuse)
  }
  async touches() {
    return (await this.ctx.storage.get<number>("touches")) ?? 0
  }
  async turns() {
    return (await this.ctx.storage.get<number>("turns")) ?? 0
  }
  /** yuki makes an agent (section 7.11). */
  async makeAgent(input: { name: string; slug: string; description: string; soul: string; model: string }) {
    const state = await this.state()
    if (state.agents.some((a) => a.slug === input.slug)) return null
    const agent: Agent = { id: `made-${input.slug}`, name: input.name, slug: input.slug as AgentSlug, prompt: input.description, model: input.model }
    await this.set({ ...state, agents: [...state.agents, agent], souls: { ...(state.souls ?? {}), [input.slug]: input.soul } })
    return agent
  }
  async openChat(title: string, agents: readonly string[]) {
    const state = await this.state()
    // Unique across tests: the room objects outlive the state each test sets.
    const roomId = `01JZ8Q4T6P${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[b % 32]).join("")}`
    await this.set({ ...state, chats: [...state.chats, { roomId, title, pinned: false, muted: false, lastSeq: 0, lastPreview: "", unread: 0, updatedAt: 0, agents } as Chat] })
    return roomId
  }
  async keepChat(roomId: string, title: string, agents: readonly string[]) {
    const state = await this.state()
    await this.set({ ...state, chats: state.chats.map((c) => (c.roomId === roomId ? { ...c, title, agents, temp: undefined } : c)) })
    return true
  }
  async userState() {
    return this.state()
  }
  /** The room records itself on its first socket. The ledger is not under test here. */
  async recordRoom() {
    return true
  }
  /** The chat list's row changed. Counted, so a test sees one touch per run. */
  async touchChat() {
    await this.ctx.storage.put("touches", ((await this.ctx.storage.get<number>("touches")) ?? 0) + 1)
  }
  /** Memory summaries: a fixed line, so tests never call a model. */
  async compress(prompt: string) {
    return { text: `summary of ${/#\d+-\d+/.exec(prompt)?.[0] ?? "?"}` }
  }
  async lifeRollup() {}
  /** Who is typing, for the chat list. Not under test here. */
  async chatTyping() {}
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
// `/end/<roomId>/<slug>/<runId>`    the agent's run ends; POST the ids of the agent envelopes it read
// `/post/<roomId>/<slug>/<runId>`   the agent posts one bubble, in run `<runId>` (default `<slug>:r1`); POST its text
// `/noprovider/<roomId>/<slug>`     the agent's batch was dropped for a missing key; POST the agent envelope ids in it
// `POST /task/<roomId>/<slug>`      the agent calls a workspace tool (WorkspaceCall)
// `/refuse/<state>`                 alice's day of turns is used ("1") or not ("0"); `/touches` counts chat list touches
// `/fail/<roomId>/<slug>/<n>`       the agent's next n receives throw
// `/refusenext/<roomId>/<slug>/<n>` the agent's next n receives are refused as too large
// `/turns`                          the turns alice has taken
// `POST /mail/<roomId>/<slug>`      the agent sends an agent message (AgentSend)
// `POST /memory/<roomId>` seqs      the room's <memory> view, without the messages `seqs`
// `POST /ask/<roomId>/<slug>`       the agent asks a teammate (AgentSend); `/askstate/<roomId>/<id>`, `/closeask/<roomId>/<id>`
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, roomId, slug, state] = new URL(request.url).pathname.split("/")
    if (kind === "user") {
      await env.USER.get(env.USER.idFromName(`user:${ALICE}`)).set((await request.json()) as UserState)
      return Response.json({ ok: true })
    }
    const user = env.USER.get(env.USER.idFromName(`user:${ALICE}`))
    if (kind === "turns") return Response.json({ turns: await user.turns() })
    if (kind === "refuse") {
      await user.refuseTurns(roomId === "1")
      return Response.json({ ok: true })
    }
    if (kind === "touches") return Response.json({ touches: await user.touches() })
    if (kind === "userstate") return Response.json(await user.userState())
    const room = roomStub(env.ROOM, ALICE, roomId!)
    if (kind === "fail") {
      await env.AGENT.get(env.AGENT.idFromName(agentName(ALICE, roomId!, slug!))).failNext(Number(state))
      return Response.json({ ok: true })
    }
    if (kind === "refusenext") {
      await env.AGENT.get(env.AGENT.idFromName(agentName(ALICE, roomId!, slug!))).refuseNext(Number(state))
      return Response.json({ ok: true })
    }
    if (kind === "index") {
      // Indexes a file with no bytes behind it: the room keeps only the row.
      const path = new URL(request.url).searchParams.get("path")!
      return Response.json(await room.putFile({ id: crypto.randomUUID(), path, r2Key: `k/${path}`, size: 2048, type: "text/markdown", sha256: path, author: { kind: "human" }, expectSha256: "none" }))
    }
    if (kind === "rm") {
      const { paths, by } = (await request.json()) as { paths: string[]; by: "agent" | "human" }
      if (by === "human") return Response.json({ refused: await room.fileOp({ op: "rm", paths }) })
      const out = await room.fsRemove(slug as AgentSlug, paths, false)
      return Response.json({ refused: out.ok ? null : out.message })
    }
    if (kind === "propose") return Response.json(await room.propose(slug as AgentSlug, (await request.json()) as never))
    if (kind === "create") {
      try {
        return Response.json(await room.createProposal(slug as AgentSlug, state!))
      } catch (e) {
        return Response.json({ ok: false, error: `threw: ${e instanceof Error ? e.message : String(e)}` })
      }
    }
    if (kind === "ask") return Response.json(await room.ask(slug as AgentSlug, (await request.json()) as never))
    if (kind === "askstate") return Response.json(await room.askState(slug!))
    if (kind === "closeask") return Response.json(await room.closeAsk(slug!))
    if (kind === "memory") return Response.json({ view: (await room.memoryView((await request.json()) as number[])).text })
    if (kind === "mail") return Response.json(await room.agentMessage(slug as AgentSlug, (await request.json()) as never))
    if (kind === "calls") return Response.json(await env.AGENT.get(env.AGENT.idFromName(agentName(ALICE, roomId!, slug!))).calls())
    if (kind === "status") {
      await room.setStatus(slug as AgentSlug, state as AgentState)
      return Response.json({ ok: true })
    }
    if (kind === "inventory") return Response.json(await room.inventory())
    if (kind === "end") {
      await room.endRun(slug as AgentSlug, state!, request.method === "POST" ? ((await request.json()) as string[]) : [])
      return Response.json({ ok: true })
    }
    if (kind === "post") {
      const text = request.method === "POST" ? ((await request.json()) as { text: string; index?: number }) : { text: "i can help" }
      return Response.json(await room.post(slug as AgentSlug, state ?? `${slug}:r1`, 0, text.index ?? 0, text.text))
    }
    if (kind === "noprovider") return Response.json(await room.noProvider(slug as AgentSlug, "opencode-go", "inbox:x", (await request.json()) as string[]))
    if (kind === "task") return Response.json(await room.workspaceCall(slug as AgentSlug, (await request.json()) as never))
    const headers = new Headers(request.headers)
    headers.set(USER_ID_HEADER, ALICE)
    headers.set(ROOM_ID_HEADER, roomId!)
    return room.fetch(new Request(request, { headers }))
  },
}
