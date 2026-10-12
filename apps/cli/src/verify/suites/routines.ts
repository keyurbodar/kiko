import { VerifyError } from "../client"
import { agentTexts, api, dev, eventually, inSeconds, ok, type Routine, systemTexts, toolLine, waitRoutine, waitRuns } from "../routine-kit"
import type { Suite } from "../runner"
import { fake, newRoom, send } from "./mid-run"


const suite: Suite = {
  name: "routines",
  async run(v) {
    const s = await v.as(`routines-${Date.now()}`)
    const url = v.url

    {
      const { roomId, room } = await newRoom(s, "routines: ask")
      await fake(v, s, roomId)
      await send(room, toolLine("create_routine", { name: "ping", instructions: "[reply] pong", trigger: { on: "time", at: inSeconds(4) } }))
      await eventually("the tool result", () => agentTexts(room).some((t) => t.includes("routine set")), 20_000)
      const r = await waitRoutine(url, s, (all) => all.find((x) => x.roomId === roomId && x.name === "ping"), "the routine")
      if (!["active", "done"].includes(r.status) || r.target !== "yuki" || r.createdBy !== "yuki") throw new VerifyError(`expected an active routine for yuki, got ${JSON.stringify(r)}`)
      const runs = await waitRuns(url, s, r.id, "the run to answer", (rs) => rs.some((x) => x.status === "ok"), 40_000)
      if (runs.length !== 1 || runs[0]?.seq === null) throw new VerifyError(`expected one ok run with a seq, got ${JSON.stringify(runs)}`)
      await eventually("pong", () => agentTexts(room).some((t) => t.includes("pong")), 5_000)
      const after = await waitRoutine(url, s, (all) => all.find((x) => x.id === r.id), "the routine")
      if (after.status !== "done") throw new VerifyError(`a one-off routine should be done after its run, got ${after.status}`)
      console.log(`  ok a human's ask made routine ${r.id} at once; it ran once (seq ${runs[0]?.seq}) and is done`)
      room.raw.close()
    }

    {
      const { roomId, room } = await newRoom(s, "routines: quiet")
      await fake(v, s, roomId)
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "nothing new", instructions: "[quiet]", trigger: { on: "time", at: inSeconds(3) } })
      const before = agentTexts(room).length
      const runs = await waitRuns(url, s, routine.id, "a quiet run", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      if (runs[0]?.status !== "quiet") throw new VerifyError(`expected quiet, got ${JSON.stringify(runs)}`)
      await Bun.sleep(1000)
      if (agentTexts(room).length !== before) throw new VerifyError(`a quiet run posted: ${JSON.stringify(agentTexts(room).slice(before))}`)
      console.log("  ok a run that had nothing to say posted nothing and was recorded quiet")
      room.raw.close()
    }

    {
      const { roomId, room } = await newRoom(s, "routines: child")
      await fake(v, s, roomId)
      const inner = { name: "child", instructions: "[quiet]", trigger: { on: "time", at: inSeconds(3600) } }
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "parent", instructions: toolLine("create_routine", inner), trigger: { on: "time", at: inSeconds(3) } })
      await waitRuns(url, s, routine.id, "the parent's run to end", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      const child = await waitRoutine(url, s, (all) => all.find((x) => x.roomId === roomId && x.name === "child"), "the routine the run made", 30_000)
      if (child.createdBy !== "yuki") throw new VerifyError(`expected yuki to make the child routine, got ${JSON.stringify(child)}`)
      console.log(`  ok a run nobody asked for made routine ${child.id} on its own`)
      room.raw.close()
    }

    {
      const { roomId, room } = await newRoom(s, "routines: outside")
      await fake(v, s, roomId)
      const made = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "send it", instructions: "[call fake_send]", trigger: { on: "time", at: inSeconds(3) } })
      await waitRuns(url, s, made.routine.id, "the run", (rs) => rs.some((x) => x.status === "ok"), 40_000)
      await eventually("the answer", () => agentTexts(room).some((t) => t.startsWith("tools:")), 5_000)
      const said = agentTexts(room).find((t) => t.startsWith("tools:"))
      if (said !== "tools: fake_send ran") throw new VerifyError(`expected the outside tool to run, got ${JSON.stringify(said)}`)
      console.log("  ok a routine run used fake_send with nobody asked")
      room.raw.close()
    }

    {
      const f = await v.as(`routines-fail-${Date.now()}`)
      const { roomId, room } = await newRoom(f, "routines: breaker")
      const { routine } = await ok<{ routine: Routine }>(url, f, "routines", { roomId, name: "doomed", instructions: "say hi", trigger: { on: "time", at: inSeconds(3600), rrule: "FREQ=DAILY" } })
      for (const n of [1, 2, 3]) {
        await ok(url, f, `routines/${routine.id}/run`, {})
        await waitRuns(url, f, routine.id, `failed run ${n}`, (rs) => rs.filter((x) => x.status === "failed").length >= n, 30_000)
      }
      const paused = await waitRoutine(url, f, (all) => all.find((x) => x.id === routine.id && x.status === "paused"), "the pause", 10_000)
      await eventually("the pause line", () => systemTexts(room).some((t) => t.includes("paused itself")), 10_000)
      const again = await api<{ delivery: string | null }>(url, f, `routines/${routine.id}/run`, {})
      if (again.json.delivery !== null) throw new VerifyError(`a paused routine ran: ${JSON.stringify(again.json)}`)
      console.log(`  ok three failed runs paused routine ${paused.id} (fails ${paused.fails}) and said so; run now refuses it`)
      room.raw.close()
    }
  },
}

export default suite
