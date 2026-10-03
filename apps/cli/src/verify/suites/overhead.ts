import type { RoomToClient, UserToClient } from "@kiko/protocol"
import { VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake, Samples } from "./latency"
import { ulid } from "./mid-run"

// What every request and every socket costs before a person sees anything, on a development server
// with the scripted fake agent (no tokens). It times the HTTP floor, the session check, the user and
// room socket handshakes, the hello replies and their size, and a send seen by a second tab. It
// asserts the resume rules: a hello at the newest seq replays nothing, and a hello a few events
// behind replays exactly those events, in order, with no gap and no repeat.

const N = Number(process.env.KIKO_OVERHEAD_RUNS ?? 20)
const now = () => performance.now()
const bytes = (value: unknown) => JSON.stringify(value).length

type Events = Extract<RoomToClient, { t: "events" }>
type Reset = Extract<UserToClient, { t: "reset" }>

const suite: Suite = {
  name: "overhead",
  async run(v) {
    const s = await v.as("overhead")
    const base = v.url.endsWith("/") ? v.url : `${v.url}/`
    const samples = new Samples()
    const get = async (path: string) => {
      const t0 = now()
      const res = await fetch(new URL(path, base), { headers: { cookie: s.cookie } })
      await res.arrayBuffer()
      if (!res.ok) throw new VerifyError(`${path} answered ${res.status}`)
      return now() - t0
    }
    for (let i = 0; i < N; i++) {
      samples.add("GET /api/health (no session)", await get("api/health"))
      samples.add("GET /api/me (session + ensureHome)", await get("api/me"))
      samples.add("GET /api/credentials (session + UserDO)", await get("api/credentials"))
    }

    // The user socket: upgrade, then hello to the first frame.
    const user = await s.user()
    await user.expect((f) => f.t === "events" || f.t === "reset")
    let snapshot: Reset["snapshot"] | null = null
    for (let i = 0; i < N; i++) {
      user.close()
      const t0 = now()
      await user.connect()
      const t1 = now()
      const reply = await user.expect((f) => f.t === "events" || f.t === "reset")
      samples.add("user socket upgrade", t1 - t0)
      samples.add("user hello to reply", now() - t1)
      if (reply.t === "reset") snapshot = reply.snapshot
    }
    // A client ahead of the server gets the snapshot a fresh device would.
    user.send({ t: "hello", lastSeq: 1_000_000_000 })
    const ahead = await user.expect((f) => f.t === "reset")
    if (ahead.t === "reset") snapshot = ahead.snapshot

    // A chat with a few turns of the fake agent, so the room has something to replay.
    const roomId = ulid()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "overhead" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await room.expect((f) => f.t === "events" || f.t === "reset")
    await fake(v, s, roomId)
    for (let i = 0; i < 3; i++) {
      const clientId = room.send(`[reply] answer ${i}`)
      await room.expect({ t: "ack", clientId })
      await room.expect((f) => f.t === "status" && f.state === "idle", 30_000)
    }

    // A second tab sees the human's message as soon as it is stored.
    const other = await s.room(roomId)
    await other.expect((f) => f.t === "events" || f.t === "reset")
    for (let i = 0; i < N; i++) {
      const t0 = now()
      const clientId = room.send(`echo ${i}`)
      await room.expect({ t: "ack", clientId })
      samples.add("send to ack", now() - t0)
      await other.expect((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.clientId === clientId))
      samples.add("send to second tab", now() - t0)
    }
    other.raw.close()
    // Let the burst close and the fake answer, so the room is quiet while it is timed.
    await room.expect((f) => f.t === "status" && f.state === "idle", 30_000)
    await Bun.sleep(500)

    // The room socket of a warm room: upgrade, then hello to the first frame.
    let full: Events | null = null
    for (let i = 0; i < N; i++) {
      room.raw.close()
      const t0 = now()
      await room.raw.connect()
      const t1 = now()
      const reply = await room.expect((f) => f.t === "events" || f.t === "reset")
      samples.add("room socket upgrade (warm room)", t1 - t0)
      samples.add("room hello to reply (lastSeq 0)", now() - t1)
      if (reply.t === "events") full = reply
    }
    if (!full) throw new VerifyError("a room hello at lastSeq 0 got no events frame")

    // Resume by seq: nothing at the newest seq, exactly the tail a few behind.
    const seqs = full.events.map((e) => e.seq)
    const last = seqs.at(-1)!
    for (let i = 1; i < seqs.length; i++) if (seqs[i]! <= seqs[i - 1]!) throw new VerifyError(`replay out of order at seq ${seqs[i]}`)
    const t0 = now()
    room.raw.send({ t: "hello", lastSeq: last })
    const none = await room.expect((f) => f.t === "events" || f.t === "reset")
    samples.add("room hello to reply (lastSeq newest)", now() - t0)
    if (none.t !== "events" || none.events.length) throw new VerifyError(`a hello at the newest seq replayed ${bytes(none)} bytes`)
    const behind = seqs.at(-5)!
    room.raw.send({ t: "hello", lastSeq: behind })
    const tail = await room.expect((f) => f.t === "events" || f.t === "reset")
    const want = seqs.filter((q) => q > behind)
    const got = tail.t === "events" ? tail.events.map((e) => e.seq) : []
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new VerifyError(`resume from ${behind} replayed ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)

    samples.print(`overhead, ${N} runs (ms)`)
    console.log(`  room hello reply at lastSeq 0: ${bytes(full)} bytes, ${full.events.length} events`)
    if (snapshot) {
      console.log(
        `  user snapshot: ${bytes(snapshot)} bytes (chats ${snapshot.chats.length}: ${bytes(snapshot.chats)}, agents ${snapshot.agents?.length ?? 0}: ${bytes(snapshot.agents ?? [])}, home: ${bytes(snapshot.home ?? null)})`,
      )
    }
    user.close()
    room.raw.close()
  },
}

export default suite
