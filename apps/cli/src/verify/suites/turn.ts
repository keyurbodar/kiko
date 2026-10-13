import { newRoomId } from "@kiko/protocol"
import type { Message, RoomToClient, UserToClient } from "@kiko/protocol"
import type { RoomHandle, UserChannel } from "../client"
import { connectTestModel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { must } from "../must"


const RESTART = process.env.KIKO_TURN_RESTART
const RESTART_AT = process.env.KIKO_TURN_RESTART_AT ?? "start"
const TIMEOUT_MS = RESTART ? 120_000 : 60_000
const QUIET_MS = 3_000


type Seen = { live: Map<string, Message>; runIds: Set<string>; started: boolean; deleted: number }

function roomState(room: RoomHandle): Seen {
  const live = new Map<string, Message>()
  const runIds = new Set<string>()
  let started = false
  const deleted = new Set<string>()
  for (const entry of room.raw.log) {
    if (entry.dir !== "in") continue
    const frame = entry.frame as RoomToClient
    if (frame.t === "status" || frame.t === "draft") started = true
    if (frame.t === "reset") {
      live.clear()
      for (const m of frame.snapshot.messages) if (m.from.kind === "agent") live.set(m.id, m)
    }
    if (frame.t !== "events") continue
    for (const e of frame.events) {
      if (e.t === "message" && e.from.kind === "agent") {
        started = true
        live.set(e.id, e)
        if (e.run) runIds.add(e.run.runId)
      }
      if (e.t === "delete") for (const id of e.messageIds) if (live.delete(id)) deleted.add(id)
    }
  }
  return { live, runIds, started, deleted: deleted.size }
}

function touches(user: UserChannel, roomId: string): number[] {
  const seqs = new Map<number, number>()
  for (const entry of user.log) {
    if (entry.dir !== "in") continue
    const frame = entry.frame as UserToClient
    if (frame.t !== "events") continue
    for (const e of frame.events) if (e.t === "chat" && e.chat.roomId === roomId && e.chat.lastSeq > 0) seqs.set(e.seq, e.chat.lastSeq)
  }
  return [...new Set(seqs.values())]
}

async function reconnect(channel: { reconnect(): Promise<void> }): Promise<void> {
  const end = Date.now() + 60_000
  for (;;) {
    try {
      await channel.reconnect()
      return
    } catch (e) {
      if (Date.now() > end) throw e
      await Bun.sleep(500)
    }
  }
}

async function restart(command: string): Promise<void> {
  const proc = Bun.spawn(["sh", "-c", command], { stdout: "inherit", stderr: "inherit" })
  if ((await proc.exited) !== 0) throw new VerifyError(`the restart command failed: ${command}`)
}

const suite: Suite = {
  name: "turn",
  model: true,
  async run(v) {
    const s = await v.as("turn")
    await connectTestModel(s)
    const roomId = newRoomId()
    const user = await s.user()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "turn check" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await room.expect((f) => f.t === "events")

    const texts = ["hi", "what is two plus two?", "answer in two short paragraphs, under twenty words in all."]
    for (const [i, text] of texts.entries()) {
      if (i) await Bun.sleep(400)
      const clientId = room.send(text)
      await room.expect({ t: "ack", clientId })
    }

    let restarted = !RESTART
    const end = Date.now() + TIMEOUT_MS
    let touchedAt = 0
    let reconnectedAt = Date.now()
    for (;;) {
      if (Date.now() > end) {
        const state = roomState(room)
        throw new VerifyError(
          `timed out. bubbles ${state.live.size}, runs ${[...state.runIds].join(",") || "none"}, touches ${touches(user, roomId).length}`,
        )
      }
      const now = roomState(room)
      if (!restarted && (RESTART_AT === "bubble" ? now.live.size > 0 : now.started)) {
        restarted = true
        console.log("  restarting the dev server during the run")
        await restart(must(RESTART, "RESTART"))
        await reconnect(room)
        await reconnect(user)
        reconnectedAt = Date.now()
      }
      const n = touches(user, roomId).length
      if (n > 0 && now.live.size > 0 && !touchedAt) touchedAt = Date.now()
      if (touchedAt && Date.now() - touchedAt > QUIET_MS) break
      await Bun.sleep(250)
      // A socket the restart closed reads nothing, so reconnect now and then. Each one replays from seq 0.
      if (RESTART && Date.now() - reconnectedAt > 5_000) {
        reconnectedAt = Date.now()
        await reconnect(room)
        await reconnect(user)
      }
    }

    const state = roomState(room)
    if (state.live.size === 0) throw new VerifyError("the run posted no bubble")
    const live = [...state.live.values()].sort((a, b) => a.seq - b.seq)
    expectEqual(new Set(live.map((m) => m.run?.runId)).size, 1, "the runs behind the live bubbles")
    expectEqual(state.runIds.size, 1, "the runs seen")
    expectEqual(new Set(live.map((m) => m.run?.attempt)).size, 1, "the attempts behind the live bubbles")
    expectEqual(
      live.map((m) => m.run?.index),
      live.map((_, i) => i),
      "the bubble indexes",
    )
    expectEqual(Math.max(...touches(user, roomId)) >= (live.at(-1)?.seq ?? 0), true, "the chat list was touched after the last bubble")
    const chat = user.log
      .flatMap((e) => (e.dir === "in" && (e.frame as UserToClient).t === "events" ? (e.frame as Extract<UserToClient, { t: "events" }>).events : []))
      .filter((e) => e.t === "chat" && e.chat.roomId === roomId)
      .at(-1)
    if (chat?.t !== "chat" || chat.chat.lastPreview === "") throw new VerifyError("the touch carries no preview")
    console.log(`  ${live.length} bubble(s) in run ${live[0]?.run?.runId} attempt ${live[0]?.run?.attempt}, ${state.deleted} deleted: ${JSON.stringify(live.map((m) => m.text))}`)
    user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
  },
}

export default suite
