import { newRoom, poll, seen, statuses } from "../kit"
import type { RoomToClient } from "@kiko/protocol"
import { connectTestModel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send } from "./mid-run"


const suite: Suite = {
  name: "mid-run-model",
  model: true,
  async run(v) {
    const s = await v.as("mid-run-model")
    await connectTestModel(s)
    const { room } = await newRoom(s, "mid-run model check")
    await send(room, "count from 1 to 300, one number per paragraph, separated by blank lines. nothing else.")
    await poll(
      "the agent to start typing",
      () => room.raw.log.some((e) => e.dir === "in" && (e.frame as RoomToClient).t === "status" && (e.frame as { state: string }).state === "typing"),
      60_000,
    )
    await Bun.sleep(3_000)
    const stoppedAt = room.raw.log.length
    room.raw.send({ t: "stop" })
    await poll(
      "the agent to go idle",
      () => room.raw.log.slice(stoppedAt).some((e) => e.dir === "in" && (e.frame as RoomToClient).t === "status" && (e.frame as { state: string }).state === "idle"),
      15_000,
    ).catch((e: Error) => {
      throw new VerifyError(`${e.message}. statuses ${statuses(room).join(",")}; bubbles ${JSON.stringify(seen(room).live.map((m) => m.text.slice(0, 60)))}`)
    })
    const atIdle = seen(room).live.length
    await Bun.sleep(5_000)
    expectEqual(seen(room).live.length, atIdle, "bubbles after the agent went idle")
    if (seen(room).live.some((m) => /\b300\b/.test(m.text))) throw new VerifyError("the run finished before stop reached it; nothing was stopped")
    await send(room, "reply with the single word ok.")
    await poll("an answer after stop", () => seen(room).live.length > atIdle, 60_000)
    await Bun.sleep(3_000)
    const bubbles = seen(room).live.map((m) => `${m.run?.runId.slice(-6)}/${m.run?.attempt}: ${m.text}`)
    console.log(`  stopped after ${atIdle} bubble(s); then ${JSON.stringify(bubbles.slice(atIdle))}; all ${JSON.stringify(bubbles)}`)
  },
}

export default suite
