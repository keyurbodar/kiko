import type { RoomHandle, Session } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake, newRoom, seen, send, statuses, until } from "./mid-run"
import { must } from "../must"


type Work = { id: string; status: string; step: string | null; submissionId: unknown }

async function workers(url: string, s: Session, roomId: string): Promise<Work[]> {
  const res = await fetch(new URL(`api/dev/agent/workers?roomId=${roomId}`, url.endsWith("/") ? url : `${url}/`), { headers: { cookie: s.cookie } })
  if (!res.ok) throw new VerifyError(`the workers route answered ${res.status}. start the Worker with NODE_ENV=development`)
  return ((await res.json()) as { workers: Work[] }).workers
}

const texts = (room: RoomHandle) => seen(room).live.map((m) => m.text)
const start = (task: string) => `[tool start_work ${JSON.stringify({ task })}]`

async function started(room: RoomHandle, task: string): Promise<void> {
  await send(room, start(task))
  await until("the agent to start w1", () => texts(room).some((t) => t.includes("started w1")), 30_000)
}

type Case = { name: string; run(room: RoomHandle, list: () => Promise<Work[]>): Promise<void> }

const cases: Case[] = [
  {
    name: "talk while the worker runs",
    async run(room, list) {
      await started(room, "[steps 4] find flights")
      await send(room, "are you there?")
      await until("an answer to the second message", () => texts(room).some((t) => t.startsWith("heard: are you there?")), 15_000)
      const [w1] = await list()
      expectEqual(w1?.status, "running", "w1 after the answer")
      if (texts(room).some((t) => t.startsWith("report"))) throw new VerifyError("the worker reported before the agent answered")
      await until("the agent to show as working between runs", () => statuses(room).at(-1) === "working", 5_000)
      await until("the worker's report", () => texts(room).some((t) => t.startsWith("report w1 done")), 30_000)
      expectEqual(texts(room).filter((t) => t.startsWith("report w1")).length, 1, "reports")
      await until("the agent to go idle", () => statuses(room).at(-1) === "idle", 10_000)
    },
  },
  {
    name: "steer",
    async run(room, list) {
      await started(room, "[steps 2] find flights")
      await send(room, `[tool steer_work ${JSON.stringify({ id: "w1", text: "only morning flights" })}]`)
      await until("the worker's report", () => texts(room).some((t) => t.startsWith("report w1 done")), 30_000)
      const report = must(texts(room).find((t) => t.startsWith("report w1 done")), "report w1 done")
      expectEqual(report, "report w1 done: work done: heard=[steps 2] find flights | only morning flights", "the report")
      expectEqual((await list())[0]?.status, "done", "w1")
    },
  },
  {
    name: "stop",
    async run(room, list) {
      await started(room, "[steps 10] find flights")
      for (const end = Date.now() + 10_000; !(await list())[0]?.step; await Bun.sleep(200)) {
        if (Date.now() > end) throw new VerifyError("timed out waiting for a step to start")
      }
      const at = Date.now()
      await send(room, `[tool stop_work ${JSON.stringify({ id: "w1" })}]`)
      await until("the stop report", () => texts(room).some((t) => t.startsWith("report w1 stopped")), 15_000)
      if (Date.now() - at > 10_000) throw new VerifyError("the stop waited for the worker's steps")
      expectEqual((await list())[0]?.status, "stopped", "w1")
      expectEqual(texts(room).filter((t) => t.startsWith("report w1")).length, 1, "reports")
    },
  },
  {
    name: "status does not touch the worker",
    async run(room, list) {
      await started(room, "[steps 8] find flights")
      const [before] = await list()
      await send(room, "what is the status?")
      await until("the status answer", () => texts(room).some((t) => t.startsWith("status: ")), 15_000)
      const answer = must(texts(room).find((t) => t.startsWith("status: ")), "the status answer")
      if (!answer.includes("w1 (running)")) throw new VerifyError(`the status answer does not show w1 running: ${answer}`)
      const [after] = await list()
      expectEqual(after?.status, "running", "w1 after the status answer")
      expectEqual(after?.submissionId, before?.submissionId, "w1's input after the status answer")
      await send(room, `[tool steer_work ${JSON.stringify({ id: "w1", text: "only morning flights" })}]`)
      await until("the worker's report", () => texts(room).some((t) => t.startsWith("report w1 done")), 40_000)
      expectEqual(
        must(texts(room).find((t) => t.startsWith("report w1")), "the report"),
        "report w1 done: work done: heard=[steps 8] find flights | only morning flights",
        "the report: the status question never reached the worker, and the note arrived once",
      )
      expectEqual(texts(room).filter((t) => t.startsWith("report w1")).length, 1, "reports")
    },
  },
]

const suite: Suite = {
  name: "workers",
  async run(v) {
    const s = await v.as("workers")
    for (const c of cases) {
      const { roomId, room } = await newRoom(s, `workers ${c.name}`)
      await fake(v, s, roomId)
      try {
        await c.run(room, () => workers(v.url, s, roomId))
      } catch (e) {
        const state = `statuses ${statuses(room).join(",") || "none"}; bubbles ${JSON.stringify(texts(room))}`
        throw new VerifyError(`${c.name}: ${e instanceof Error ? e.message : String(e)}\n  ${state}`)
      }
      console.log(`  ok ${c.name}: ${JSON.stringify(texts(room).map((t) => (t.length > 70 ? `${t.slice(0, 67)}...` : t)))}`)
      room.raw.close()
    }
  },
}

export default suite
