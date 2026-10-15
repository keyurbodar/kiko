
import { newRoomId } from "@kiko/protocol"
import type { RoomToClient, UserToClient } from "@kiko/protocol"
import { type RoomHandle, type Session, type Verifier, VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake, readStats, resetStats, Samples } from "./latency"
import { must } from "../must"


const N = Number(process.env.KIKO_OVERHEAD_RUNS ?? 20)
const BIG = Number(process.env.KIKO_OVERHEAD_BIG ?? 1500)
const now = () => performance.now()
const bytes = (value: unknown) => JSON.stringify(value).length

type Events = Extract<RoomToClient, { t: "events" }>
type Reset = Extract<UserToClient, { t: "reset" }>

async function sendCost(room: RoomHandle, text: string): Promise<string> {
  await Bun.sleep(300)
  await resetStats(must(v0, "verifier"), must(s0, "session"))
  const clientId = room.send(text)
  await room.expect({ t: "ack", clientId })
  await Bun.sleep(300)
  const c = await readStats(must(v0, "verifier"), must(s0, "session"))
  const pick = (suffix: string) => Object.entries(c).filter(([k]) => k.endsWith(suffix)).map(([k, n]) => `${k.split(".")[0]} ${n}`).join(", ")
  const rpc = Object.entries(c).filter(([k]) => k.startsWith("rpc.")).map(([k, n]) => `${k.slice(4)} ${n}`).join(", ")
  return `rows read [${pick(".rowsRead")}], rows written [${pick(".rowsWritten")}], statements [${pick(".statements")}], rpc [${rpc}]`
}

let v0: Verifier | null = null
let s0: Session | null = null

const suite: Suite = {
  name: "overhead",
  async run(v) {
    const s = await v.as("overhead")
    v0 = v
    s0 = s
    const base = v.url
    const samples = new Samples()
    const get = async (path: string) => {
      const t0 = now()
      const res = await fetch(new URL(path, base), { headers: { authorization: s.auth } })
      await res.arrayBuffer()
      if (!res.ok) throw new VerifyError(`${path} answered ${res.status}`)
      return now() - t0
    }
    for (let i = 0; i < N; i++) {
      samples.add("GET /api/health (no session)", await get("api/health"))
      samples.add("GET /api/me (session + ensureHome)", await get("api/me"))
      samples.add("GET /api/credentials (session + UserDO)", await get("api/credentials"))
    }

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
    user.send({ t: "hello", lastSeq: 1_000_000_000 })
    const ahead = await user.expect((f) => f.t === "reset")
    if (ahead.t === "reset") snapshot = ahead.snapshot

    const roomId = newRoomId()
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
    const smallSend = await sendCost(room, "cost")
    await room.expect((f) => f.t === "status" && f.state === "idle", 30_000)
    await Bun.sleep(500)

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

    const seqs = full.events.map((e) => e.seq)
    const last = must(seqs.at(-1), "last seq")
    for (let i = 1; i < seqs.length; i++) if (must(seqs[i], "seq") <= must(seqs[i - 1], "seq")) throw new VerifyError(`replay out of order at seq ${seqs[i]}`)
    const t0 = now()
    room.raw.send({ t: "hello", lastSeq: last })
    const none = await room.expect((f) => f.t === "events" || f.t === "reset")
    samples.add("room hello to reply (lastSeq newest)", now() - t0)
    if (none.t !== "events" || none.events.length) throw new VerifyError(`a hello at the newest seq replayed ${bytes(none)} bytes`)
    const behind = must(seqs.at(-5), "behind seq")
    room.raw.send({ t: "hello", lastSeq: behind })
    const tail = await room.expect((f) => f.t === "events" || f.t === "reset")
    const want = seqs.filter((q) => q > behind)
    const got = tail.t === "events" ? tail.events.map((e) => e.seq) : []
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new VerifyError(`resume from ${behind} replayed ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)

    const bigId = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: bigId as never, title: "overhead big" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === bigId))
    const big = await s.room(bigId)
    await big.expect((f) => f.t === "events" || f.t === "reset")
    const tFill = now()
    let lastId = ""
    for (let i = 0; i < BIG; i++) lastId = big.send(`filler message ${i} with a few words in it.`)
    await big.expect({ t: "ack", clientId: lastId }, 120_000)
    big.raw.send({ t: "stop" })
    const bigSend = await sendCost(big, "cost")
    big.raw.send({ t: "stop" })
    samples.add(`${BIG} sends back to back, per send`, (now() - tFill) / BIG)
    await Bun.sleep(500)
    for (let i = 0; i < N; i++) {
      const t0 = now()
      const clientId = big.send(`big ${i}.`)
      await big.expect({ t: "ack", clientId })
      samples.add(`send to ack (${BIG} messages)`, now() - t0)
    }
    big.raw.send({ t: "stop" })
    for (let i = 0; i < 5; i++) {
      big.raw.close()
      const t0 = now()
      await big.raw.connect()
      await big.expect((f) => f.t === "events" || f.t === "reset")
      samples.add(`room connect to first frame (${BIG} messages)`, now() - t0)
    }
    big.raw.close()

    samples.print(`overhead, ${N} runs (ms)`)
    console.log(`  one human send, room with ~70 events: ${smallSend}`)
    console.log(`  one human send, room with ${BIG} messages: ${bigSend}`)
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
