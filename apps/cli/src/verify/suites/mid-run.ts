import type { Message, RoomToClient } from "@yuki/protocol"
import type { RoomHandle, Session } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"


const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
export function ulid(): string {
  let time = Date.now()
  let head = ""
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[time % 32] + head
    time = Math.floor(time / 32)
  }
  return head + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")
}

export async function newRoom(s: Session, title: string): Promise<{ roomId: string; room: RoomHandle }> {
  const roomId = ulid()
  const user = await s.user()
  user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title } })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = await s.room(roomId)
  await room.expect((f) => f.t === "events" || f.t === "reset")
  return { roomId, room }
}

export function seen(room: RoomHandle): { all: Message[]; live: Message[]; deleted: number } {
  const all: Message[] = []
  const gone = new Set<string>()
  for (const entry of room.raw.log) {
    if (entry.dir !== "in") continue
    const frame = entry.frame as RoomToClient
    if (frame.t !== "events") continue
    for (const e of frame.events) {
      if (e.t === "message" && e.from.kind === "agent" && !all.some((m) => m.id === e.id)) all.push(e)
      if (e.t === "delete") for (const id of e.messageIds) gone.add(id)
    }
  }
  const live = all.filter((m) => !gone.has(m.id)).sort((a, b) => a.seq - b.seq)
  return { all, live, deleted: all.filter((m) => gone.has(m.id)).length }
}

export function statuses(room: RoomHandle): string[] {
  return room.raw.log.flatMap((e) => (e.dir === "in" && (e.frame as RoomToClient).t === "status" ? [(e.frame as Extract<RoomToClient, { t: "status" }>).state] : []))
}

export async function until(what: string, test: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new VerifyError(`timed out waiting for ${what}`)
    await Bun.sleep(100)
  }
}

export async function send(room: RoomHandle, text: string): Promise<void> {
  const clientId = room.send(text)
  await room.expect({ t: "ack", clientId })
}

const texts = (room: RoomHandle) => seen(room).live.map((m) => m.text)

export async function fake(v: { url: string }, s: Session, roomId: string, slugs?: string[]): Promise<void> {
  const res = await fetch(new URL("api/dev/agent/fake", v.url.endsWith("/") ? v.url : `${v.url}/`), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: s.cookie },
    body: JSON.stringify({ roomId, ...(slugs ? { slugs } : {}) }),
  })
  if (!res.ok) throw new VerifyError(`the fake agent route answered ${res.status}. start the Worker with NODE_ENV=development`)
}

type Case = { name: string; run(room: RoomHandle): Promise<void> }

const cases: Case[] = [
  {
    name: "restart before the first bubble",
    async run(room) {
      await send(room, "[slow] one")
      await until("the agent to start", () => statuses(room).includes("typing"), 10_000)
      await send(room, "two")
      await until("an answer", () => texts(room).some((t) => t.startsWith("heard:")), 20_000)
      await Bun.sleep(2_000)
      const { all, deleted } = seen(room)
      expectEqual(
        all.map((m) => m.text),
        ["heard: [slow] one | two"],
        "the agent's bubbles: one answer to both turns, nothing from the aborted run",
      )
      expectEqual(deleted, 0, "deleted bubbles")
    },
  },
  {
    name: "steer during a tool",
    async run(room) {
      await send(room, "[tool] check")
      await until("the tool to start", () => statuses(room).includes("working"), 10_000)
      await send(room, "also this")
      await until("an answer to both turns", () => texts(room).some((t) => t.startsWith("heard: [tool] check | also this;")), 3_000)
      await Bun.sleep(3_000)
      const { all, deleted } = seen(room)
      expectEqual(all.length, 1, "the agent's bubbles: one answer")
      expectEqual(all[0]?.text.includes("slept"), false, "the stopped tool did not finish")
      expectEqual(deleted, 0, "deleted bubbles")
    },
  },
  {
    name: "steer during a write",
    async run(room) {
      await send(room, "[write] save")
      await until("the write to start", () => statuses(room).includes("working"), 10_000)
      await send(room, "also this")
      await until("an answer to both turns", () => texts(room).some((t) => t.startsWith("heard:")), 20_000)
      await Bun.sleep(2_000)
      const { all, deleted } = seen(room)
      expectEqual(
        all.map((m) => m.text),
        ["heard: [write] save | also this; tool: slept"],
        "the agent's bubbles: the write ran to its end, and one answer covers both turns",
      )
      expectEqual(deleted, 0, "deleted bubbles")
    },
  },
  {
    name: "steer after a bubble",
    async run(room) {
      await send(room, "[two-part] first")
      await until("the first bubble", () => texts(room).includes("part one."), 10_000)
      await send(room, "next")
      await until("the answer to the second message", () => texts(room).includes("heard: next"), 25_000)
      await Bun.sleep(2_000)
      const { live, deleted } = seen(room)
      expectEqual(live.length, 3, "bubbles")
      expectEqual(live[0]?.text, "part one.", "the first bubble")
      if (!live[1]?.text.endsWith("heard: [two-part] first")) throw new VerifyError(`the first run did not finish its answer: ${live[1]?.text}`)
      expectEqual(live[2]?.text, "heard: next", "the answer to the steered message")
      expectEqual(live[0]?.run?.runId === live[1]?.run?.runId, true, "the first two bubbles share a run")
      expectEqual(deleted, 0, "deleted bubbles")
    },
  },
  {
    name: "stop",
    async run(room) {
      await send(room, "[two-part] a")
      await until("the first bubble", () => texts(room).includes("part one."), 10_000)
      await send(room, "b")
      await Bun.sleep(2_500)
      const stoppedAt = room.raw.log.length
      room.raw.send({ t: "stop" })
      await until(
        "the agent to go idle",
        () => room.raw.log.slice(stoppedAt).some((e) => e.dir === "in" && (e.frame as RoomToClient).t === "status" && (e.frame as { state: string }).state === "idle"),
        5_000,
      )
      await Bun.sleep(6_000)
      expectEqual(texts(room), ["part one."], "the bubbles after stop")
      await send(room, "c")
      await until("an answer after stop", () => texts(room).length > 1, 15_000)
      await Bun.sleep(1_000)
      expectEqual(texts(room), ["part one.", "heard: [two-part] a | c; tool: slept"], "the answer after stop: b was discarded")
    },
  },
]

const suite: Suite = {
  name: "mid-run",
  async run(v) {
    const s = await v.as("mid-run")
    for (const c of cases) {
      const { roomId, room } = await newRoom(s, `mid-run ${c.name}`)
      await fake(v, s, roomId)
      try {
        await c.run(room)
      } catch (e) {
        const state = `statuses ${statuses(room).join(",") || "none"}; bubbles ${JSON.stringify(seen(room).all.map((m) => m.text))}`
        throw new VerifyError(`${c.name}: ${e instanceof Error ? e.message : String(e)}\n  ${state}`)
      }
      console.log(`  ok ${c.name}: ${JSON.stringify(texts(room).map((t) => (t.length > 60 ? `${t.slice(0, 30)}...${t.slice(-28)}` : t)))}`)
      room.raw.close()
    }
  },
}

export default suite
