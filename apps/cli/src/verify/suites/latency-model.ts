import { poll, seen } from "../kit"
import { newRoomId } from "@yuki/protocol"
import { connectTestModel } from "../client"
import type { Suite } from "../runner"
import { Samples, timedTurn } from "./latency"
import { send } from "./mid-run"


const RUNS = Number(process.env.YUKI_LATENCY_RUNS ?? 10)
const WEB_RUNS = Number(process.env.YUKI_LATENCY_WEB_RUNS ?? 3)

const suite: Suite = {
  name: "latency-model",
  model: true,
  async run(v) {
    const s = await v.as("latency")
    await connectTestModel(s)
    const user = await s.user()
    const roomId = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "latency model" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await room.expect((f) => f.t === "events" || f.t === "reset")
    const samples = new Samples()
    for (let i = 0; i < RUNS; i++) {
      await timedTurn(room, `run ${i}: reply with two paragraphs of three words each.`, samples, i === 0 ? "cold agent" : "warm agent", 60_000)
    }
    for (let i = 0; i < WEB_RUNS; i++) {
      const before = seen(room).live.length
      const t0 = performance.now()
      await send(room, `web ${i}: what is the main heading on https://example.com? one line.`)
      await poll("a first bubble", () => seen(room).live.length > before, 90_000)
      samples.add("web question: send to first bubble", performance.now() - t0)
      await poll("the answer", () => seen(room).live.slice(before).some((m) => /example domain/i.test(m.text)), 120_000)
      samples.add("web question: send to answer", performance.now() - t0)
      await Bun.sleep(3_000)
    }
    samples.print(`test model, ${RUNS} runs (ms)`)
    user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
  },
}

export default suite
