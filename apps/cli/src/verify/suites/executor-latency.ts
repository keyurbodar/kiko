import type { RoomToClient } from "@yuki/protocol"
import { VerifyError } from "../client"
import type { Suite } from "../runner"
import { readStats, resetStats, Samples } from "./latency"
import { ulid } from "./mid-run"

// How long a task through Executor takes, as a person feels it. It signs in as YUKI_EXECUTOR_USER
// (default `dev`, the local account), which must already have Executor and a model connected. Each
// run opens a new chat, asks a first task, then a follow-up in the same chat, and records the time
// from send to idle with the model turns, Executor calls, and Executor HTTP requests behind it.
// Read-only tasks that ask for live data, so nothing pauses for approval. YUKI_EXECUTOR_RUNS sets the runs (default 3),
// YUKI_EXECUTOR_MODEL the model the chats use, and YUKI_EXECUTOR_KEEP=1 keeps the chats to read.

const RUNS = Number(process.env.YUKI_EXECUTOR_RUNS ?? 3)
const USER = process.env.YUKI_EXECUTOR_USER ?? "dev"
/** A model for the chats, such as `opencode-go/muse-spark-1.3-contributor`. Unset leaves the server default. */
const MODEL = process.env.YUKI_EXECUTOR_MODEL
// Each asks for live data, so memory cannot answer it.
const TASKS = [
  { tag: "new chat", text: "check github now: what is the newest commit message on my most recently pushed repo? one line." },
  { tag: "follow-up", text: "check again now: my 3 most recently updated github repos, names only." },
]
const TIMEOUT_MS = 240_000

type Status = Extract<RoomToClient, { t: "status" }>
type Events = Extract<RoomToClient, { t: "events" }>

const suite: Suite = {
  name: "executor-latency",
  model: true,
  human: true,
  async run(v) {
    const s = await v.as(USER)
    const user = await s.user()
    const samples = new Samples()
    const answers: string[] = []
    for (let i = 0; i < RUNS; i++) {
      const roomId = ulid()
      user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: `executor latency ${i}` } })
      await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
      const room = await s.room(roomId)
      await room.expect((f) => f.t === "events" || f.t === "reset")
      if (MODEL) {
        room.raw.send({ t: "model", ref: MODEL })
        await Bun.sleep(500)
      }
      for (const task of TASKS) {
        await resetStats(v, s)
        const t0 = performance.now()
        const clientId = room.send(task.text)
        await room.expect({ t: "ack", clientId })
        let first = 0
        let text = ""
        for (;;) {
          const f = await room.expect((x) => (x.t === "status" && (x as Status).state === "idle" && first > 0) || (x.t === "events" && (x as Events).events.some((e) => e.t === "message" && e.from.kind === "agent")), TIMEOUT_MS)
          if (f.t === "status") break
          first ||= performance.now() - t0
          for (const e of (f as Events).events) if (e.t === "message" && e.from.kind === "agent") text += `${e.text} / `
        }
        const total = performance.now() - t0
        await Bun.sleep(300)
        const c = await readStats(v, s)
        const calls = Object.entries(c).filter(([k]) => k.startsWith("executor.call.")).reduce((n, [, x]) => n + x, 0)
        // A follow-up may answer from what the chat already fetched, which is right and fast.
        if (calls === 0 && task.tag === "new chat") throw new VerifyError(`${task.tag}: the agent made no executor call. is executor connected for ${USER}? it said: ${text}`)
        samples.add(`${task.tag}: send to idle (s)`, Math.round(total / 100) / 10)
        samples.add(`${task.tag}: send to first bubble (s)`, Math.round(first / 100) / 10)
        samples.add(`${task.tag}: model turns`, c["model.turns"] ?? 0)
        samples.add(`${task.tag}: model (s)`, Math.round((c["model.ms"] ?? 0) / 100) / 10)
        samples.add(`${task.tag}: executor calls`, calls)
        samples.add(`${task.tag}: executor http requests`, c["executor.http"] ?? 0)
        samples.add(`${task.tag}: executor http (s)`, Math.round((c["executor.httpMs"] ?? 0) / 100) / 10)
        const models = Object.entries(c).filter(([k]) => k.startsWith("model.id.")).map(([k]) => k.slice(9)).join(" ")
        const tools = Object.entries(c).filter(([k]) => k.startsWith("executor.call.")).map(([k, n]) => `${k.slice(14)}×${n}`).join(" ")
        answers.push(`${task.tag}: <${models}> [${tools}] ${text.slice(0, 160)}`)
      }
      if (!process.env.YUKI_EXECUTOR_KEEP) user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
    }
    for (const a of answers) console.log(`  ${a}`)
    samples.print(`executor tasks as ${USER}, ${RUNS} runs`)
  },
}

export default suite
