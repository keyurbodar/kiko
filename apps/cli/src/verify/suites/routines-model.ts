
import { agentTexts, newRoom, poll } from "../kit"
import { connectTestModel, type RoomHandle, type Session, VerifyError } from "../client"
import { dev, inSeconds, ok, type Routine, routines, waitRuns } from "../routine-kit"
import type { Suite } from "../runner"
import { send } from "./mid-run"


const N = Number(process.env.ROUTINES_MODEL_N ?? 3)

type Spent = { agent: { input: number; output: number; cacheRead: number; cacheWrite: number } }

async function spent(url: string, s: Session, roomId: string): Promise<number> {
  const u = ((await dev(url, s, "usage", { roomId })) as Spent).agent
  return u.input + u.output + u.cacheRead + u.cacheWrite
}

async function ask(room: RoomHandle, text: string, ms = 120_000): Promise<string[]> {
  const before = agentTexts(room).length
  await send(room, text)
  await poll(`an answer to ${JSON.stringify(text.slice(0, 40))}`, () => agentTexts(room).length > before, ms)
  let count = agentTexts(room).length
  for (;;) {
    await Bun.sleep(4_000)
    if (agentTexts(room).length === count) return agentTexts(room).slice(before)
    count = agentTexts(room).length
  }
}

const suite: Suite = {
  name: "routines-model",
  model: true,
  async run(v) {
    const url = v.url
    const s = await v.as(`routines-model-${Date.now()}`)
    await connectTestModel(s)
    const failures: string[] = []
    const check = (ok: boolean, what: string) => {
      if (!ok) failures.push(what)
      console.log(`  ${ok ? "ok  " : "MISS"} ${what}`)
    }

    const asks: { text: string; want: (r: Routine[], reminders: number) => boolean; what: string }[] = [
      { text: "every weekday at 8:30 send me a two line summary of what's on my plate", what: "a weekday time routine", want: (r) => r.some((x) => x.trigger?.on === "time") },
      { text: "whenever a task here moves to review, check it and tell me in one line what's left", what: "a task routine for review", want: (r) => r.some((x) => x.trigger?.on === "task") },
      { text: "keep an eye on https://example.com, check it every hour and tell me if it changes", what: "a watch every 60 minutes", want: (r) => r.some((x) => x.trigger?.on === "watch") },
      { text: "remind me in 10 minutes to stretch", what: "a reminder, not a routine", want: (r, reminders) => r.length === 0 && reminders === 1 },
    ]
    let weekday: { roomId: string; routine: Routine; room: RoomHandle } | null = null
    for (const a of asks) {
      const { roomId, room } = await newRoom(s, `model: ${a.what}`)
      const said = await ask(room, a.text)
      const all = (await routines(url, s)).routines.filter((r) => r.roomId === roomId)
      const reminders = (await ok<{ roomId: string; trigger: unknown; status: string }[]>(url, s, "reminders")).filter((r) => r.roomId === roomId && !r.trigger && r.status === "active").length
      check(a.want(all, reminders), `"${a.text}" -> ${a.what}: ${all.map((r) => `${r.name} ${JSON.stringify(r.trigger)}`).join("; ") || `${reminders} reminder(s)`} | said ${JSON.stringify(said.join(" / ").slice(0, 160))}`)
      if (a.what.startsWith("a weekday") && all[0]) weekday = { roomId, routine: all[0], room }
      else room.raw.close()
    }

    if (weekday) {
      const { roomId, routine, room } = weekday
      const costs: number[] = []
      for (let i = 0; i < N; i++) {
        const before = { bubbles: agentTexts(room).length, tokens: await spent(url, s, roomId), at: Date.now() }
        await ok(url, s, `routines/${routine.id}/run`, {})
        const runs = await waitRuns(url, s, routine.id, `run ${i + 1}`, (rs) => rs.filter((x) => x.status !== "running").length > i, 180_000)
        await Bun.sleep(2_000)
        const bubbles = agentTexts(room).slice(before.bubbles)
        const cost = (await spent(url, s, roomId)) - before.tokens
        costs.push(cost)
        check(runs[0]?.status === "ok" && bubbles.length >= 1 && bubbles.length <= 4, `run ${i + 1}: ${runs[0]?.status}, ${bubbles.length} bubbles, ${Math.round((Date.now() - before.at) / 1000)}s, ${cost} tokens: ${JSON.stringify(bubbles.join(" / ").slice(0, 200))}`)
      }
      check(Math.max(...costs) < 3 * Math.min(...costs) + 5_000, `run cost stays steady: ${costs.join(", ")} tokens`)
      room.raw.close()
    } else failures.push("no weekday routine to run")

    {
      const { roomId, room } = await newRoom(s, "model: quiet")
      await ask(room, "hi")
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", {
        roomId,
        name: "review sweep",
        instructions: "look at this chat's task board. if no task is in review, say nothing. if some are, list them in one line.",
        trigger: { on: "time", at: inSeconds(3600), rrule: "FREQ=DAILY" },
      })
      let quiet = 0
      for (let i = 0; i < N; i++) {
        await ok(url, s, `routines/${routine.id}/run`, {})
        const runs = await waitRuns(url, s, routine.id, `quiet run ${i + 1}`, (rs) => rs.filter((x) => x.status !== "running").length > i, 180_000)
        if (runs[0]?.status === "quiet") quiet++
      }
      check(quiet === N, `with no task in review, ${quiet} of ${N} runs stayed quiet. said: ${JSON.stringify(agentTexts(room).slice(1).join(" / ").slice(0, 200))}`)
      room.raw.close()
    }

    {
      const { roomId, room } = await newRoom(s, "model: event")
      await ask(room, "hi")
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", {
        roomId,
        name: "review check",
        instructions: "a task moved to review. tell the human in one line which task and what to look at.",
        trigger: { on: "task", status: ["review"] },
      })
      const before = agentTexts(room).length
      room.raw.send({ t: "task", op: { op: "create", id: "draft", title: "draft the pricing page" } })
      room.raw.send({ t: "task", op: { op: "update", id: "draft", status: "review" } })
      const runs = await waitRuns(url, s, routine.id, "the event run", (rs) => rs.some((x) => x.status !== "running"), 180_000)
      await Bun.sleep(3_000)
      const said = agentTexts(room).slice(before)
      check(runs.length === 1 && runs[0]?.status === "ok" && said.length >= 1 && said.length <= 2 && said.join(" ").toLowerCase().includes("pricing"), `event run: ${runs[0]?.status}, ${said.length} bubbles: ${JSON.stringify(said.join(" / ").slice(0, 200))}`)
      room.raw.close()
    }

    if (failures.length) throw new VerifyError(`${failures.length} miss(es):\n${failures.map((f) => `- ${f}`).join("\n")}`)
  },
}

export default suite
