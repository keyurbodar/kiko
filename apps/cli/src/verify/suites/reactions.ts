import type { MessageId, RoomEvent, RoomToClient } from "@yuki/protocol"
import type { RoomHandle } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake, newRoom, seen, statuses, until } from "./mid-run"


type React = Extract<RoomEvent, { t: "react" }>

function reacts(room: RoomHandle): React[] {
  return room.raw.log.flatMap((entry) => {
    const frame = entry.frame as RoomToClient
    return entry.dir === "in" && frame.t === "events" ? frame.events.filter((e): e is React => e.t === "react") : []
  })
}

function runs(room: RoomHandle): number {
  let count = 0
  let busy = false
  for (const state of statuses(room)) {
    if (state === "idle") busy = false
    else if (!busy) {
      busy = true
      count++
    }
  }
  return count
}

const idle = (room: RoomHandle) => statuses(room).at(-1) === "idle"

async function send(room: RoomHandle, text: string): Promise<MessageId> {
  const clientId = room.send(text)
  const ack = await room.expect({ t: "ack", clientId })
  return (ack as Extract<RoomToClient, { t: "ack" }>).id
}

async function answered(room: RoomHandle, before: number): Promise<void> {
  await until("the run to start", () => runs(room) > before, 10_000)
  await until("the run to end", () => idle(room), 15_000)
}

const texts = (room: RoomHandle) => seen(room).live.map((m) => m.text)

const suite: Suite = {
  name: "reactions",
  async run(v) {
    const s = await v.as("reactions")
    const { roomId, room } = await newRoom(s, "reactions")
    await fake(v, s, roomId)
    const step = (what: string) => console.log(`  ok ${what}`)
    try {
      const first = await send(room, "[reply] [react:👍]")
      await answered(room, 0)
      await until("the agent's reaction", () => reacts(room).length > 0, 5_000)
      expectEqual(reacts(room).map((r) => ({ on: r.messageId, by: r.by, emoji: r.emoji })), [{ on: first, by: { kind: "agent", slug: "yuki" }, emoji: "👍" }], "the reactions")
      expectEqual(texts(room), [], "the agent's bubbles")
      step(`a reply of [react:👍] reacted on the human's message and posted no bubble`)

      await send(room, `[reply] [react:🔥:${first}]`)
      await answered(room, 1)
      await until("the second reaction", () => reacts(room).length > 1, 5_000)
      expectEqual(reacts(room).at(-1)?.emoji, "🔥", "the second reaction")
      expectEqual(reacts(room).at(-1)?.messageId, first, "the second reaction's target")
      await send(room, `[reply] [react:🔥:${first}]`)
      await answered(room, 2)
      await Bun.sleep(1_000)
      expectEqual(reacts(room).length, 2, "react events after repeating the same emoji")
      step("a second reaction replaced the first, and a repeat stored nothing")

      await send(room, "[reply] [react:🦄]")
      await answered(room, 3)
      await Bun.sleep(1_000)
      expectEqual(reacts(room).length, 2, "react events after [react:🦄]")
      expectEqual(texts(room), [], "the agent's bubbles")
      step("[react:🦄] was dropped")

      expectEqual(runs(room), 4, "runs after four human messages and three agent reactions")
      await send(room, "hi")
      await answered(room, 4)
      const bubble = seen(room).live.at(-1)
      if (!bubble) throw new VerifyError("the agent did not answer hi")
      room.raw.send({ t: "react", messageId: bubble.id, emoji: "❤️" })
      await until("the human's reaction", () => reacts(room).some((r) => r.by.kind === "human"), 5_000)
      await Bun.sleep(4_000)
      expectEqual(runs(room), 5, "runs after the human reacted")
      step("no reaction started a run")

      await send(room, "[brief]")
      await answered(room, 5)
      await until("the brief echo", () => texts(room).some((t) => t.startsWith("brief:")), 5_000)
      expectEqual(texts(room).at(-1), `brief: the human reacted ❤️ to your "${bubble.text}"`, "the next brief")
      await send(room, "[brief]")
      await answered(room, 6)
      await until("the second brief echo", () => texts(room).filter((t) => t.startsWith("brief:")).length > 1, 5_000)
      expectEqual(texts(room).at(-1), "brief: none", "the brief after that")
      step("the human's reaction reached the agent in its next brief, once")
    } catch (e) {
      const state = `runs ${runs(room)}; reactions ${JSON.stringify(reacts(room).map((r) => r.emoji))}; bubbles ${JSON.stringify(texts(room))}`
      throw new VerifyError(`${e instanceof Error ? e.message : String(e)}\n  ${state}`)
    } finally {
      room.raw.close()
    }
  },
}

export default suite
