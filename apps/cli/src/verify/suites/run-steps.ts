import type { Message, RunStep } from "@kiko/protocol"
import type { RoomHandle, Session } from "../client"
import { expectEqual, VerifyError } from "../client"
import { frames, idles, messages, newRoom, poll } from "../kit"
import { must } from "../must"
import type { Suite } from "../runner"
import { readStats, resetStats } from "./latency"
import { fake, send } from "./mid-run"

const FAKE_MS = 30_000

const stepFrames = (room: RoomHandle, id?: string): RunStep[] =>
  frames(room).flatMap((f): RunStep[] => (f.t === "step" && (id === undefined || f.step.id === id) ? [f.step] : []))

const bubbles = (room: RoomHandle): Message[] => messages(room).filter((m) => m.from.kind === "agent")

async function snapshot(s: Session, roomId: string) {
  const other = await s.room(roomId)
  other.raw.sendRaw(JSON.stringify({ t: "hello", lastSeq: 1_000_000_000 }))
  const reset = await other.expect((f) => f.t === "reset", 5_000)
  other.raw.close()
  if (reset.t !== "reset") throw new VerifyError("no snapshot")
  return reset.snapshot
}

async function stepsOf(room: RoomHandle, runId: string): Promise<readonly RunStep[]> {
  room.raw.send({ t: "steps", runId })
  const answer = await room.expect((f) => f.t === "steps" && f.runId === runId, 5_000)
  if (answer.t !== "steps") throw new VerifyError("no steps answer")
  return answer.steps
}

let base = 0
const go = async (room: RoomHandle, text: string) => {
  base = idles(room)
  await send(room, text)
}
/** The agent went idle after the last message this suite sent. */
const idle = (room: RoomHandle) => idles(room) > base

const suite: Suite = {
  name: "run-steps",
  async run(v) {
    const s = await v.as("run-steps")
    const { roomId, room } = await newRoom(s, "run steps")
    await fake(v, s, roomId, ["kiko"])

    // A slow tool: the step is running (held by the room, not stored), the snapshot carries it, then it is done.
    await go(room, "[tool] check")
    const started = await poll("a running step", () => stepFrames(room).find((x) => x.status === "running"), FAKE_MS)
    expectEqual(
      { slug: started.slug, name: started.name, label: started.label, tool: started.tool, output: started.output, endedAt: started.endedAt },
      { slug: "kiko", name: "slow_tool", label: "Used slow_tool", tool: "other", output: undefined, endedAt: undefined },
      "the running step",
    )
    const mid = await snapshot(s, roomId)
    expectEqual(mid.steps?.map((x) => [x.id, x.status, x.runId]), [[started.id, "running", started.runId]], "the steps in a snapshot while the tool runs")
    await poll("the step to end", () => stepFrames(room, started.id).some((x) => x.status === "done"), FAKE_MS)
    const done = must(stepFrames(room, started.id).find((x) => x.status === "done"), "the done step")
    expectEqual({ label: done.label, output: done.output, runId: done.runId, startedAt: done.startedAt }, { label: "Used slow_tool", output: "slept", runId: started.runId, startedAt: started.startedAt }, "the done step")
    if (done.endedAt === undefined || done.endedAt < done.startedAt) throw new VerifyError(`the step ended before it began: ${JSON.stringify(done)}`)
    expectEqual(stepFrames(room, started.id).map((x) => x.status), ["running", "done"], "the frames of one step")
    console.log(`  ok a tool call is a running step, then a done step with its output: ${JSON.stringify(done)}`)

    await poll("the run's bubble", () => bubbles(room).find((m) => m.run?.runId === started.runId), FAKE_MS)
    await poll("the agent to go idle", () => idle(room), FAKE_MS)
    const bubble = must(bubbles(room).find((m) => m.run?.runId === started.runId), "the run's bubble")
    expectEqual(bubble.steps, 1, "the step count on the bubble the run posted")
    expectEqual((await snapshot(s, roomId)).steps, undefined, "the steps in a snapshot once the run has ended")
    console.log("  ok the bubble the run posted carries its step count, and a snapshot after the run carries no live steps")

    // The answer to a request, twice, and from a second socket: the same steps, no duplicates.
    const first = await stepsOf(room, started.runId)
    expectEqual(first.map((x) => [x.id, x.status, x.label]), [[started.id, "done", "Used slow_tool"]], "the steps of the run")
    expectEqual(await stepsOf(room, started.runId), first, "the steps asked for a second time")
    const other = await s.room(roomId)
    expectEqual(await stepsOf(other, started.runId), first, "the steps asked for on a second socket")
    other.raw.close()
    expectEqual(await stepsOf(room, "no-such-run"), [], "the steps of a run that never was")
    const seen = new Set(stepFrames(room).map((x) => `${x.runId}/${x.id}/${x.status}`))
    expectEqual(seen.size, stepFrames(room).length, "step frames that repeat")
    console.log("  ok asking for a run's steps answers the same list every time, and only the asker hears it")

    // The lead's own tools: a failing one, and an internal tool that makes no step.
    const before = stepFrames(room).length
    await go(room, '[tool update_task {"id":"no-such-task","status":"done"}]')
    const failedStep = await poll("the failing step to end", () => stepFrames(room).slice(before).find((x) => x.name === "update_task" && x.status !== "running"), FAKE_MS)
    expectEqual({ status: failedStep.status, label: failedStep.label, hasOutput: Boolean(failedStep.output) }, { status: "failed", label: "Used update_task", hasOutput: true }, "a task update that cannot work")
    await poll("the agent to go idle", () => idle(room), FAKE_MS)
    const quiet = stepFrames(room).length
    await go(room, "[tool team {}]")
    await poll("the agent to go idle", () => idle(room), FAKE_MS)
    expectEqual(stepFrames(room).length, quiet, "step frames from an internal tool")
    console.log("  ok a failing tool is a failed step with its error, and an internal tool makes no step")

    // Parallel calls in one round travel to the room together, and the room needs no separate doing report.
    await Bun.sleep(300)
    await resetStats(v, s)
    const parallel = stepFrames(room).length
    await go(room, "[call fake_lookup] [call fake_lookup] [call fake_lookup]")
    await poll("three finished steps", () => stepFrames(room).slice(parallel).filter((x) => x.status === "done").length === 3, FAKE_MS)
    await poll("the agent to go idle", () => idle(room), FAKE_MS)
    const stats = await readStats(v, s)
    const reports = stats["rpc.room.reportSteps"] ?? 0
    console.log(`  info three parallel calls: reportSteps rpc ${reports}, reportDoing rpc ${stats["rpc.room.reportDoing"] ?? 0}`)
    if (reports > 3) throw new VerifyError(`three parallel tool calls sent ${reports} step requests; they should be batched into at most 3`)
    expectEqual(stats["rpc.room.reportDoing"] ?? 0, 0, "separate doing reports")
    console.log("  ok parallel tool calls are batched into few requests, with no separate doing report")

    // A background worker: its calls are steps of the run that started it, marked with the worker.
    const fromWorker = stepFrames(room).length
    await go(room, '[tool web_fetch {"url":"http://localhost:1/page"}]')
    const work = await poll("the worker's read step to end", () => stepFrames(room).slice(fromWorker).find((x) => x.worker && x.label === "Fetched localhost:1" && x.status !== "running"), FAKE_MS * 2)
    const startedWork = must(stepFrames(room).slice(fromWorker).find((x) => x.name === "start_work"), "the start_work step")
    expectEqual(work.runId, startedWork.runId, "the run a worker's step belongs to")
    expectEqual({ status: work.status, tool: work.tool, name: work.name, worker: work.worker?.id }, { status: "failed", tool: "web", name: "web_fetch", worker: "w1" }, "the worker's step")
    await poll("the agent to go idle", () => idle(room), FAKE_MS * 2)
    const all = await stepsOf(room, work.runId)
    expectEqual(all.some((x) => x.id === work.id && x.worker?.id === "w1"), true, "the worker's step among the run's steps")
    console.log(`  ok a worker's tool call is a step of the run that started it: ${JSON.stringify(work)}`)
  },
}

export default suite
