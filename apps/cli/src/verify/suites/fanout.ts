import type { ClientToUser, RoomToClient } from "@yuki/protocol"
import { connectTestModel, type RoomHandle, VerifyError } from "../client"
import type { Suite } from "../runner"
import { readStats, resetStats } from "./latency"
import { newRoom } from "./mid-run"

// Parallel tool fan-out, end to end with a real model. Needs OPENCODE_API_KEY and COMPOSIO_API_KEY.
// Connects Composio, warms one chat so a direct web-search tool is learned, then asks for 20 and
// 30 web searches in ONE response. From the server's dev counters it checks the call count, the
// wall time, and that the calls overlapped: the sum of per-call ms must exceed wall time by 1/0.6.

const USER = "fanout-alice"
const MODEL = process.env.YUKI_COMPOSIO_MODEL ?? "opencode-go/muse-spark-1.3-contributor"
const TOOL = "composio_search_web"
const TURN_MS = 150_000
const WALL_LIMIT_MS = 60_000
const MIN_CALLS = 15
const MAX_OVERLAP = 0.6

const TOPICS = [
  "latest stable Bun version", "latest stable Deno version", "latest stable Node.js LTS version", "latest Rust stable release",
  "latest Go release", "latest Python release", "latest TypeScript release", "latest React release",
  "latest Vite release", "latest SQLite release", "latest PostgreSQL major release", "latest Linux kernel stable",
  "latest Kubernetes release", "latest Docker Engine release", "latest Zig release", "latest Swift release",
  "latest Kotlin release", "latest Java LTS release", "latest PHP release", "latest Ruby release",
  "latest Elixir release", "latest Svelte release", "latest Vue release", "latest Angular release",
  "latest Next.js release", "latest Tailwind CSS release", "latest Redis release", "latest MongoDB release",
  "latest Terraform release", "latest Git release",
]

type Events = Extract<RoomToClient, { t: "events" }>
type Status = Extract<RoomToClient, { t: "status" }>
type Row = { turn: string; calls: number; wallMs: number; sumMs: number; ratio: number }

const prompt = (topics: string[]) =>
  `Use Composio to search the web for each of these ${topics.length} topics. Call the ${TOOL} tool ${topics.length} times, all in ONE response as parallel tool calls, one call per topic, do not do them one after another. Then answer with one line per topic.\n${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}`

const suite: Suite = {
  name: "fanout",
  model: true,
  human: true,
  async run(v) {
    const key = process.env.COMPOSIO_API_KEY
    if (!key) throw new VerifyError("COMPOSIO_API_KEY is not set in this shell")
    const s = await v.as(USER)
    await connectTestModel(s)
    const user = await s.user()

    let n = 0
    const ask = async (frame: Record<string, unknown>) => {
      const reqId = `f${++n}`
      user.send({ ...frame, reqId } as unknown as ClientToUser)
      const answer = await user.expect((f) => "reqId" in f && f.reqId === reqId && f.t === "composio", 60_000)
      if (!("result" in answer) || typeof answer.result !== "object" || answer.result === null) throw new VerifyError(`no composio result for ${frame.t}`)
      return answer.result
    }
    await ask({ t: "disconnectComposio" })
    const result = await ask({ t: "connectComposio", apiKey: key })
    if (!("ok" in result) || result.ok !== true) throw new VerifyError(`composio connect failed: ${JSON.stringify(result)}`)

    const open = async (title: string) => {
      const opened = await newRoom(s, title)
      opened.room.raw.send({ t: "model", ref: MODEL })
      await Bun.sleep(500)
      return opened
    }
    const turn = async (room: RoomHandle, question: string) => {
      const t0 = performance.now()
      const clientId = room.send(question)
      await room.expect({ t: "ack", clientId })
      let seen = false
      let text = ""
      for (;;) {
        const f = await room.expect((x) => (x.t === "status" && (x as Status).state === "idle" && seen) || (x.t === "events" && (x as Events).events.some((e) => e.t === "message" && e.from.kind === "agent")), TURN_MS)
        if (f.t === "status") break
        seen = true
        for (const e of (f as Events).events) if (e.t === "message" && e.from.kind === "agent") text += `${e.text} / `
      }
      return { text, total: performance.now() - t0 }
    }

    const rooms: string[] = []
    const rows: Row[] = []
    const errors = (c: Record<string, number>) => Object.entries(c).filter(([k, n]) => n > 0 && /error|fail/i.test(k) && (k.startsWith("composio.") || k.startsWith("tool.")))

    // Warm: one chat so a learned direct tool exists.
    const warm = await open("fanout warm")
    rooms.push(warm.roomId)
    const w = await turn(warm.room, "Use Composio to search the web: what is the latest stable Bun version? Answer in one line.")
    console.log(`warm: ${(w.total / 1000).toFixed(1)} s, ${w.text.slice(0, 120)}`)

    const fan = async (name: string, count: number) => {
      const { roomId, room } = await open(`fanout ${name}`)
      rooms.push(roomId)
      await resetStats(v, s)
      const { text, total } = await turn(room, prompt(TOPICS.slice(0, count)))
      await Bun.sleep(300)
      const counters = await readStats(v, s)
      const calls = counters[`composio.call.${TOOL}`] ?? 0
      const sumMs = counters[`composio.${TOOL}.ms`] ?? 0
      const ratio = sumMs > 0 ? total / sumMs : Number.POSITIVE_INFINITY
      const composioCounters = Object.entries(counters).filter(([k]) => k.startsWith("composio.")).map(([k, c]) => `${k}=${c}`).join(" ")
      console.log(`    counters: ${composioCounters}`)
      console.log(`  ${name}: asked ${count}, calls ${calls}, wall ${(total / 1000).toFixed(1)} s, sum of call ms ${sumMs}, wall/sum ${ratio.toFixed(3)} (limit ${MAX_OVERLAP}), model turns ${counters["model.turns"] ?? 0}`)
      console.log(`    reply: ${text.slice(0, 160)}`)
      const bad = errors(counters)
      if (bad.length) throw new VerifyError(`${name}: error counters: ${bad.map(([k, n]) => `${k}=${n}`).join(", ")}`)
      const numbers = `calls ${calls}, wall ${total.toFixed(0)} ms, sum ${sumMs} ms, ratio ${ratio.toFixed(3)}`
      if (calls < MIN_CALLS) throw new VerifyError(`${name}: only ${calls} of ${count} ${TOOL} calls (need ${MIN_CALLS}). ${numbers}. reply: ${text.slice(0, 200)}`)
      if (total >= WALL_LIMIT_MS) throw new VerifyError(`${name}: wall time over ${WALL_LIMIT_MS} ms. ${numbers}`)
      if (!(ratio < MAX_OVERLAP)) throw new VerifyError(`${name}: calls did not overlap (wall/sum ${ratio.toFixed(3)} >= ${MAX_OVERLAP}). ${numbers}`)
      rows.push({ turn: name, calls, wallMs: Math.round(total), sumMs, ratio })
    }

    try {
      await fan("A (20)", 20)
      await fan("B (30)", 30)
    } finally {
      for (const roomId of rooms) user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
      await ask({ t: "disconnectComposio" }).catch(() => undefined)
    }

    console.log("turn      calls  wall ms  sum call ms  wall/sum")
    for (const r of rows) console.log(`${r.turn.padEnd(9)} ${String(r.calls).padStart(5)}  ${String(r.wallMs).padStart(7)}  ${String(r.sumMs).padStart(11)}  ${r.ratio.toFixed(3).padStart(8)}`)
  },
}

export default suite
