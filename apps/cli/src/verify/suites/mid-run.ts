import type { RoomToClient } from "@kiko/protocol"
import type { RoomHandle, Session } from "../client"
import { expectEqual, VerifyError } from "../client"
import { newRoom, poll, seen, statuses } from "../kit"
import type { Suite } from "../runner"



export async function send(room: RoomHandle, text: string): Promise<void> {
  const clientId = room.send(text)
  await room.expect({ t: "ack", clientId })
}

const texts = (room: RoomHandle) => seen(room).live.map((m) => m.text)

export async function fake(v: { url: string }, s: Session, roomId: string, slugs?: string[]): Promise<void> {
  const res = await fetch(new URL("api/dev/agent/fake", v.url), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: s.auth },
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
      await poll("the agent to start", () => statuses(room).includes("typing"), 10_000)
      await send(room, "two")
      await poll("an answer", () => texts(room).some((t) => t.startsWith("heard:")), 20_000)
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
      await poll("the tool to start", () => statuses(room).includes("working"), 10_000)
      await send(room, "also this")
      await poll("an answer to both turns", () => texts(room).some((t) => t.startsWith("heard: [tool] check | also this;")), 3_000)
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
      await poll("the write to start", () => statuses(room).includes("working"), 10_000)
      await send(room, "also this")
      await poll("an answer to both turns", () => texts(room).some((t) => t.startsWith("heard:")), 20_000)
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
      await poll("the first bubble", () => texts(room).includes("part one."), 10_000)
      await send(room, "next")
      await poll("the answer to the second message", () => texts(room).includes("heard: next"), 25_000)
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
      await poll("the first bubble", () => texts(room).includes("part one."), 10_000)
      await send(room, "b")
      await Bun.sleep(2_500)
      const stoppedAt = room.raw.log.length
      room.raw.send({ t: "stop" })
      await poll(
        "the agent to go idle",
        () => room.raw.log.slice(stoppedAt).some((e) => e.dir === "in" && (e.frame as RoomToClient).t === "status" && (e.frame as { state: string }).state === "idle"),
        5_000,
      )
      await Bun.sleep(6_000)
      expectEqual(texts(room), ["part one."], "the bubbles after stop")
      await send(room, "c")
      await poll("an answer after stop", () => texts(room).length > 1, 15_000)
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
