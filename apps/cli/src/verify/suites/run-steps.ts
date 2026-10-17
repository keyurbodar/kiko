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

async function stepsOf(room: RoomHandle, slug: string, after: number, upTo?: number): Promise<readonly RunStep[]> {
  room.raw.send({ t: "steps", slug: slug as RunStep["slug"], after, ...(upTo !== undefined ? { upTo } : {}) })
  const answer = await room.expect((f) => f.t === "steps" && f.slug === slug && f.after === after && f.upTo === upTo, 5_000)
  if (answer.t !== "steps") throw new VerifyError("no steps answer")
  return answer.steps
}

/** The steps a bubble opens, as the room answers for its window. */
const opens = (room: RoomHandle, m: Message) => (m.from.kind === "agent" && m.steps ? stepsOf(room, m.from.slug, m.stepAfter ?? 0, m.seq) : Promise.resolve([]))

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
    expectEqual([bubble.steps, bubble.stepAfter], [1, 0], "the step count and window start on the agent's first bubble")
    expectEqual((await snapshot(s, roomId)).steps, undefined, "the steps in a snapshot once every step has a bubble")
    console.log("  ok the bubble carries the count of steps since the agent's last bubble, and a snapshot after it carries no tail")

    // The answer to a request, twice, and from a second socket: the same steps, no duplicates.
    const first = await opens(room, bubble)
    expectEqual(first.map((x) => [x.id, x.status, x.label]), [[started.id, "done", "Used slow_tool"]], "the steps the bubble opens")
    expectEqual(await opens(room, bubble), first, "the steps asked for a second time")
    const other = await s.room(roomId)
    expectEqual(await opens(other, bubble), first, "the steps asked for on a second socket")
    other.raw.close()
    expectEqual(await stepsOf(room, "nobody", 0), [], "the steps of an agent that never was")
    const seen = new Set(stepFrames(room).map((x) => `${x.runId}/${x.id}/${x.status}`))
    expectEqual(seen.size, stepFrames(room).length, "step frames that repeat")
    console.log("  ok asking for a bubble's steps answers the same list every time, and only the asker hears it")

    // A run that posts, calls a tool, then posts again: each bubble counts the steps its run had started when it was posted.
    const split = stepFrames(room).length
    const splitFrom = bubbles(room).length
    await go(room, "[two-part] go")
    await poll("the agent to go idle", () => idle(room), FAKE_MS)
    const parts = bubbles(room).slice(splitFrom)
    const splitStep = must(stepFrames(room).slice(split).find((x) => x.status === "done"), "the step between the two bubbles")
    expectEqual(
      parts.map((m) => [m.run?.runId, m.steps ?? 0]),
      [
        [splitStep.runId, 0],
        [splitStep.runId, 1],
      ],
      "the step counts of a run's two bubbles",
    )
    expectEqual((await opens(room, must(parts[1], "the second part"))).map((x) => x.id), [splitStep.id], "the steps the second part opens")
    const reloaded = (await snapshot(s, roomId)).messages.filter((m) => parts.some((p) => p.id === m.id))
    expectEqual(reloaded.map((m) => [m.steps, m.stepAfter]), parts.map((m) => [m.steps, m.stepAfter]), "the step windows a reload reads")
    console.log("  ok a run's bubbles each open the steps made since the one before, live and after a reload")

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

    // A background worker: its calls come after the run that started it posted, so the agent's report opens them.
    const fromWorker = stepFrames(room).length
    const fromReport = bubbles(room).length
    await go(room, '[tool web_fetch {"url":"http://localhost:1/page"}]')
    const work = await poll("the worker's read step to end", () => stepFrames(room).slice(fromWorker).find((x) => x.worker && x.label === "Fetched localhost:1" && x.status !== "running"), FAKE_MS * 2)
    const startedWork = must(stepFrames(room).slice(fromWorker).find((x) => x.name === "start_work"), "the start_work step")
    expectEqual(work.runId, startedWork.runId, "the run a worker's step belongs to")
    expectEqual({ status: work.status, tool: work.tool, name: work.name, worker: work.worker?.id }, { status: "failed", tool: "web", name: "web_fetch", worker: "w1" }, "the worker's step")
    const report = await poll("the worker's report", () => bubbles(room).slice(fromReport).find((m) => m.text.startsWith("report w1")), FAKE_MS * 2)
    await poll("the agent to go idle", () => idle(room), FAKE_MS * 2)
    expectEqual((await opens(room, report)).map((x) => x.name), ["start_work", "web_fetch"], "the steps the report opens")
    const again = must((await snapshot(s, roomId)).messages.find((m) => m.id === report.id), "the report after a reload")
    expectEqual([again.steps, again.stepAfter], [report.steps, report.stepAfter], "the report's window after a reload")
    console.log(`  ok a worker's tool call is opened by the agent's report, live and after a reload: ${JSON.stringify(work)}`)
  },
}

export default suite
