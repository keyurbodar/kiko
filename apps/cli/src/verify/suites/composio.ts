import type { ClientToUser, RoomToClient } from "@yuki/protocol"
import { connectTestModel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { readStats, resetStats } from "./latency"
import { ulid } from "./mid-run"

// Composio, end to end with a real model. Needs OPENCODE_API_KEY (the model, opencode-go) and
// COMPOSIO_API_KEY (a consumer key, ck_...) in the shell. Part one: a bad key is refused and
// stores nothing. Part two: connect the real key, ask a fresh chat to search the web through
// Composio, and prove from the server's dev counters (`composio.<tool>.ms`, bumped on every tool
// call) that a composio_* tool ran and that a reply bubble arrived. Hard limits: 60 s per socket
// answer, 150 s for the chat turn.

const USER = "composio-alice"
const MODEL = process.env.YUKI_COMPOSIO_MODEL ?? "opencode-go/muse-spark-1.3-contributor"
const ASK = "Use Composio to search the web: what is the latest stable Bun version? Answer in one line."
const TURN_MS = 150_000

type Result = { ok: true; status: { connected: boolean; rows: number }; tools?: string[] } | { ok: false; error: string }
type Events = Extract<RoomToClient, { t: "events" }>
type Status = Extract<RoomToClient, { t: "status" }>

const suite: Suite = {
  name: "composio",
  model: true,
  human: true,
  async run(v) {
    const key = process.env.COMPOSIO_API_KEY
    if (!key) throw new VerifyError("COMPOSIO_API_KEY is not set in this shell")
    const s = await v.as(USER)
    await connectTestModel(s)
    const user = await s.user()
    let n = 0
    const ask = async (frame: Record<string, unknown>): Promise<Result> => {
      const reqId = `c${++n}`
      user.send({ ...frame, reqId } as unknown as ClientToUser)
      const answer = await user.expect((f) => (f as { t: string; reqId?: string }).t === "composio" && (f as { reqId?: string }).reqId === reqId, 60_000)
      return (answer as unknown as { result: Result }).result
    }

    // Start clean, then a bad key.
    await ask({ t: "disconnectComposio" })
    const bad = await ask({ t: "connectComposio", apiKey: "ck_not_a_real_key_0000" })
    if (bad.ok) throw new VerifyError("a bad composio key was accepted")
    console.error(`bad key refused: ${bad.error}`)
    const after = await ask({ t: "composioStatus" })
    if (!after.ok) throw new VerifyError(`status after a bad key failed: ${after.error}`)
    expectEqual(after.status.connected, false, "connected after a bad key")
    expectEqual(after.status.rows, 0, "rows after a bad key")

    // The real key.
    const good = await ask({ t: "connectComposio", apiKey: key })
    if (!good.ok) throw new VerifyError(`connect failed: ${good.error}`)
    expectEqual(good.status.connected, true, "connected")
    const listed = await ask({ t: "composioStatus", tools: true })
    if (!listed.ok || !listed.tools?.length) throw new VerifyError("composio listed no tools")
    console.error(`tools: ${listed.tools.join(", ")}`)

    const roomId = ulid()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "composio" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await room.expect((f) => f.t === "events" || f.t === "reset")
    room.raw.send({ t: "model", ref: MODEL })
    await Bun.sleep(500)
    await resetStats(v, s)

    const t0 = performance.now()
    const clientId = room.send(ASK)
    await room.expect({ t: "ack", clientId })
    let first = 0
    let text = ""
    for (;;) {
      const f = await room.expect((x) => (x.t === "status" && (x as Status).state === "idle" && first > 0) || (x.t === "events" && (x as Events).events.some((e) => e.t === "message" && e.from.kind === "agent")), TURN_MS)
      if (f.t === "status") break
      first ||= performance.now() - t0
      for (const e of (f as Events).events) if (e.t === "message" && e.from.kind === "agent") text += `${e.text} / `
    }
    const total = performance.now() - t0
    await Bun.sleep(300)

    const counters = await readStats(v, s)
    const tools = Object.keys(counters).filter((k) => /^composio\.[^.]+\.ms$/.test(k)).map((k) => k.split(".")[1]!)
    if (!tools.length) throw new VerifyError(`no composio_* tool was called. the agent said: ${text}`)
    if (!first) throw new VerifyError("no reply bubble arrived")

    console.log(`  tools called: ${tools.join(" ")}`)
    console.log(`  models: ${Object.keys(counters).filter((k) => k.startsWith("model.id.")).map((k) => k.slice(9)).join(" ")}`)
    console.log(`  reply: ${text.slice(0, 200)}`)
    console.log(`  time to first bubble: ${(first / 1000).toFixed(1)} s, total: ${(total / 1000).toFixed(1)} s`)

    const gone = await ask({ t: "disconnectComposio" })
    if (!gone.ok) throw new VerifyError(`disconnect failed: ${gone.error}`)
    expectEqual([gone.status.connected, gone.status.rows], [false, 0], "connected and rows after disconnect")
    user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
  },
}

export default suite
