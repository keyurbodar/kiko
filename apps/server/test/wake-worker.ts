import { agentName, roomStub, userStub } from "../src/lib/names"
import { RoomDO as BaseRoom } from "../src/room/room-do"
import type { UserDO } from "../src/user/user-do"
import type { FakeAgent } from "./fake-agent"

import { UserDO as BaseUser } from "../src/user/user-do"
import type { SignalBatch } from "../src/room/signals"
export { FakeAgent } from "./fake-agent"

export class UserDO extends BaseUser {
  async loseResults(n: number) {
    await this.ctx.storage.put("lose_results", n)
  }

  override async signals(batch: SignalBatch) {
    const lose = (await this.ctx.storage.get<number>("lose_results")) ?? 0
    if (lose > 0 && batch.signals.some((s) => s.kind === "routine_result")) {
      await this.ctx.storage.put("lose_results", lose - 1)
      throw new Error("network connection lost")
    }
    return super.signals(batch)
  }
}

export class RoomDO extends BaseRoom {
  async adoptFor(userId: string) {
    const room = this as unknown as { adopt(id: string): object; chat(home: object): Promise<object | null>; seedMembers(home: object, chat: object): Promise<void> }
    const home = room.adopt(userId)
    const chat = await room.chat(home)
    if (chat) await room.seedMembers(home, chat)
  }

  async followed() {
    return this.ctx.storage.sql.exec("SELECT routine_id AS routineId, occurrence, started FROM routine_inflight ORDER BY routine_id, occurrence").toArray()
  }

  async say(text: string) {
    const out = this.humanSend({ t: "send", clientId: crypto.randomUUID(), text })
    if ("events" in out) this.publish(out.events)
  }
}

type Env = { USER: DurableObjectNamespace<UserDO>; ROOM: DurableObjectNamespace<RoomDO>; AGENT: DurableObjectNamespace<FakeAgent> }

export default {
  async fetch(request: Request, env: Env) {
    const [, kind, user, roomId, slug, n] = new URL(request.url).pathname.split("/") as string[]
    if (kind === "user") {
      const { method, args } = (await request.json()) as { method: string; args: unknown[] }
      const result = await (userStub(env.USER, user!) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...args)
      return Response.json({ result: result ?? null })
    }
    const room = roomStub(env.ROOM, user!, roomId!) as unknown as DurableObjectStub<RoomDO>
    if (kind === "room") {
      const { method, args } = (await request.json()) as { method: string; args: unknown[] }
      return Response.json({ result: (await (room as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...args)) ?? null })
    }
    if (kind === "adopt") return Response.json((await room.adoptFor(user!)) ?? null)
    if (kind === "say") return Response.json((await room.say(((await request.json()) as { text: string }).text)) ?? null)
    if (kind === "task") return Response.json(await room.workspaceCall(slug as never, (await request.json()) as never))
    const agent = env.AGENT.get(env.AGENT.idFromName(agentName(user!, roomId!, slug!)))
    if (kind === "refuse") return Response.json((await agent.refuseNext(Number(n))) ?? null)
    if (kind === "fail") return Response.json((await agent.failNext(Number(n))) ?? null)
    return Response.json(await agent.calls())
  },
}
