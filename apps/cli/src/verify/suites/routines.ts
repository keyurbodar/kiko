import type { Approval, RoomToClient } from "@yuki/protocol"
import { type RoomHandle, VerifyError } from "../client"
import { agentTexts, api, dev, eventually, inSeconds, ok, type Routine, routines, systemTexts, toolLine, waitRoutine, waitRuns } from "../routine-kit"
import type { Suite } from "../runner"
import { fake, newRoom, send } from "./mid-run"

// Architecture section 25.2 and 25.3, with the scripted fake agent: no tokens. A human's ask makes a
// routine at once; a routine runs once per occurrence, posts its answer, or stays quiet and says so in
// its run record; a routine that wants a new routine waits for the human's card; a run that read
// outside content and wants a grant waits for the card too, and the accepted routine is clean; a grant
// lets a routine use one outside tool and nothing else; runs past the day's budget are held; a run past its time
// budget is stopped; three failed runs pause the routine. Needs NODE_ENV=development.

function cards(room: RoomHandle): Approval[] {
  return room.raw.log.flatMap((e) => {
    if (e.dir !== "in") return []
    const f = e.frame as RoomToClient
    return f.t === "events" ? f.events.flatMap((ev) => (ev.t === "approval" ? [ev.approval] : [])) : []
  })
}

const suite: Suite = {
  name: "routines",
  async run(v) {
    const s = await v.as(`routines-${Date.now()}`)
    const url = v.url

    // 1. The human asks; the agent makes the routine in the same run, no card. It runs once and answers.
    {
      const { roomId, room } = await newRoom(s, "routines: ask")
      await fake(v, s, roomId)
      await send(room, toolLine("create_routine", { name: "ping", instructions: "[reply] pong", trigger: { on: "time", at: inSeconds(4) } }))
      await eventually("the tool result", () => agentTexts(room).some((t) => t.includes("routine set")), 20_000)
      const r = await waitRoutine(url, s, (all) => all.find((x) => x.roomId === roomId && x.name === "ping"), "the routine")
      if (!["active", "done"].includes(r.status) || r.target !== "yuki" || r.createdBy !== "yuki") throw new VerifyError(`expected an active routine for yuki, got ${JSON.stringify(r)}`)
      if (cards(room).length) throw new VerifyError("a human's own ask posted a card")
      const runs = await waitRuns(url, s, r.id, "the run to answer", (rs) => rs.some((x) => x.status === "ok"), 40_000)
      if (runs.length !== 1 || runs[0]!.seq === null) throw new VerifyError(`expected one ok run with a seq, got ${JSON.stringify(runs)}`)
      await eventually("pong", () => agentTexts(room).some((t) => t.includes("pong")), 5_000)
      const after = await waitRoutine(url, s, (all) => all.find((x) => x.id === r.id), "the routine")
      if (after.status !== "done") throw new VerifyError(`a one-off routine should be done after its run, got ${after.status}`)
      console.log(`  ok a human's ask made routine ${r.id} at once; it ran once (seq ${runs[0]!.seq}) and is done`)

      // A clean run the human started may grant an outside tool without a card.
      await send(room, toolLine("create_routine", { name: "pinger", instructions: "[quiet]", may: ["fake_send"], trigger: { on: "time", at: inSeconds(3600) } }))
      const p = await waitRoutine(url, s, (all) => all.find((x) => x.roomId === roomId && x.name === "pinger"), "the granted routine")
      if (p.tainted || p.grant.join() !== "fake_send") throw new VerifyError(`expected a clean routine granted fake_send, got ${JSON.stringify(p)}`)
      await Bun.sleep(500)
      if (cards(room).length) throw new VerifyError("a clean human run's grant posted a card")
      console.log("  ok a clean human run granted fake_send to a routine with no card")
      room.raw.close()
    }

    // 2. Quiet: [skip] posts nothing and the run says quiet.
    {
      const { roomId, room } = await newRoom(s, "routines: quiet")
      await fake(v, s, roomId)
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "nothing new", instructions: "[quiet]", trigger: { on: "time", at: inSeconds(3) } })
      const before = agentTexts(room).length
      const runs = await waitRuns(url, s, routine.id, "a quiet run", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      if (runs[0]!.status !== "quiet") throw new VerifyError(`expected quiet, got ${JSON.stringify(runs)}`)
      await Bun.sleep(1000)
      if (agentTexts(room).length !== before) throw new VerifyError(`a quiet run posted: ${JSON.stringify(agentTexts(room).slice(before))}`)
      console.log("  ok a run that had nothing to say posted nothing and was recorded quiet")
      room.raw.close()
    }

    // 3. A routine run (no human) that wants a new routine gets a card; nothing exists until accept.
    {
      const { roomId, room } = await newRoom(s, "routines: card")
      await fake(v, s, roomId)
      const inner = { name: "child", instructions: "[quiet]", trigger: { on: "time", at: inSeconds(3600) } }
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "parent", instructions: toolLine("create_routine", inner), trigger: { on: "time", at: inSeconds(3) } })
      await eventually("a card for create_routine", () => cards(room).some((c) => c.tool === "create_routine" && c.state === "pending"), 40_000)
      const card = cards(room).find((c) => c.tool === "create_routine")!
      if ((await routines(url, s)).routines.some((x) => x.name === "child")) throw new VerifyError("the routine existed before the human accepted")
      if (Math.round((card.expiresAt - Date.now()) / 60_000) !== 30) throw new VerifyError(`a card should wait 30 minutes, expires in ${card.expiresAt - Date.now()} ms`)
      room.raw.send({ t: "approve", approvalId: card.id, action: "accept" })
      const child = await waitRoutine(url, s, (all) => all.find((x) => x.roomId === roomId && x.name === "child"), "the accepted routine", 30_000)
      console.log(`  ok a run nobody asked for posted card ${card.id} ("${card.summary.slice(0, 60)}..."); accept made ${child.id}`)
      await waitRuns(url, s, routine.id, "the parent's run to end", (rs) => rs.some((x) => x.status !== "running"), 30_000)
      room.raw.close()
    }

    // 3b. A run that read a page asking for a routine with a grant waits for the card. Accepted, the
    // routine is the human's: stored clean, with its grant. A new room, since an ok is a 30-minute grant.
    {
      const { roomId, room } = await newRoom(s, "routines: tainted grant")
      await fake(v, s, roomId)
      const granted = { name: "granted child", instructions: "[call fake_send]", may: ["fake_send"], trigger: { on: "time", at: inSeconds(3600) } }
      await send(room, `[fetch] ${toolLine("create_routine", granted)}`)
      await eventually("a card for the granted routine", () => cards(room).some((c) => c.tool === "create_routine" && c.state === "pending" && c.summary.includes("granted child")), 30_000)
      room.raw.send({ t: "approve", approvalId: cards(room).find((c) => c.summary.includes("granted child") && c.state === "pending")!.id, action: "accept" })
      const g = await waitRoutine(url, s, (all) => all.find((x) => x.roomId === roomId && x.name === "granted child"), "the granted routine", 30_000)
      if (g.tainted || g.grant.join() !== "fake_send") throw new VerifyError(`the accepted routine should be clean and keep its grant, got ${JSON.stringify(g)}`)
      const before = agentTexts(room).filter((t) => t.startsWith("tools:")).length
      await ok(url, s, `routines/${g.id}/run`, {})
      await eventually("the granted child's answer", () => agentTexts(room).filter((t) => t.startsWith("tools:")).length > before, 30_000)
      const said = agentTexts(room).filter((t) => t.startsWith("tools:")).at(-1)
      if (said !== "tools: fake_send ran") throw new VerifyError(`a grant the human accepted on a card did not work: ${JSON.stringify(said)}`)
      console.log("  ok a tainted run's routine with a grant waited for the card; accepted, it was stored clean and its run used fake_send")
      room.raw.close()
    }

    // 4. A grant lets the routine use exactly that outside tool; without it the call needs a card.
    {
      const { roomId, room } = await newRoom(s, "routines: grant")
      await fake(v, s, roomId)
      const granted = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "send it", instructions: "[call fake_send]", may: ["fake_send"], trigger: { on: "time", at: inSeconds(3) } })
      await waitRuns(url, s, granted.routine.id, "the granted run", (rs) => rs.some((x) => x.status === "ok"), 40_000)
      await eventually("the granted answer", () => agentTexts(room).some((t) => t.startsWith("tools:")), 5_000)
      const said = agentTexts(room).find((t) => t.startsWith("tools:"))
      if (said !== "tools: fake_send ran") throw new VerifyError(`expected the granted tool to run, got ${JSON.stringify(said)}`)
      const bare = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "send it bare", instructions: "[call fake_send]", trigger: { on: "time", at: inSeconds(3) } })
      await waitRuns(url, s, bare.routine.id, "the ungranted run", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      await eventually("the blocked answer", () => agentTexts(room).filter((t) => t.startsWith("tools:")).length >= 2, 5_000)
      const blocked = agentTexts(room).filter((t) => t.startsWith("tools:"))[1]
      if (blocked !== "tools: fake_send blocked") throw new VerifyError(`expected the ungranted call blocked, got ${JSON.stringify(blocked)}`)
      if (!cards(room).some((c) => c.tool === "fake_send" && c.state === "pending")) throw new VerifyError("the blocked call posted no card")
      console.log("  ok a granted routine ran fake_send; the same routine without the grant was blocked and got a card")
      room.raw.close()
    }

    // 5. The day's budget: the user's runs that nobody asked for stop at the limit, with one line.
    {
      const b = await v.as(`routines-budget-${Date.now()}`)
      const { roomId, room } = await newRoom(b, "routines: budget")
      await fake(v, b, roomId)
      await dev(url, b, "limits", { roomId, limits: { autonomousRunsPerDay: 2 } })
      const made: Routine[] = []
      for (const n of [1, 2, 3]) made.push((await ok<{ routine: Routine }>(url, b, "routines", { roomId, name: `tick ${n}`, instructions: `[reply] tick ${n}`, trigger: { on: "time", at: inSeconds(3) } })).routine)
      for (const r of made) await waitRuns(url, b, r.id, `run of ${r.name}`, (rs) => rs.some((x) => x.status !== "running"), 40_000)
      const statuses = await Promise.all(made.map(async (r) => (await waitRuns(url, b, r.id, "a run", (rs) => rs.length > 0))[0]!.status))
      if (statuses.filter((x) => x === "held").length !== 1 || statuses.filter((x) => x === "ok").length !== 2) throw new VerifyError(`expected 2 ok and 1 held, got ${JSON.stringify(statuses)}`)
      await eventually("the budget line", () => systemTexts(room).some((t) => t.includes("used its runs")), 5_000)
      if (systemTexts(room).filter((t) => t.includes("used its runs")).length !== 1) throw new VerifyError("the budget line was posted more than once")
      await dev(url, b, "limits", { roomId, limits: { autonomousRunsPerDay: 100 } })
      console.log(`  ok with a limit of 2, runs went ${statuses.join(", ")} and the chat said so once`)
      room.raw.close()
    }

    // 6. A run past its time budget is told once to wrap up, then stopped at twice the budget, and
    // recorded as a timeout. The tool sleeps two minutes, so only the abort can end the run in time.
    {
      const { roomId, room } = await newRoom(s, "routines: timeout")
      await fake(v, s, roomId)
      await dev(url, s, "budget", { roomId, ms: 5_000 })
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "slow", instructions: '[tool slow_tool {"ms":120000}]', trigger: { on: "time", at: inSeconds(2) } })
      const started = Date.now()
      const runs = await waitRuns(url, s, routine.id, "a timeout", (rs) => rs.some((x) => x.status !== "running"), 100_000)
      if (runs[0]!.status !== "timeout") throw new VerifyError(`expected a timeout, got ${JSON.stringify(runs)}`)
      await dev(url, s, "budget", { roomId, ms: 600_000 })
      console.log(`  ok a run that would take 2 minutes was stopped after ${Math.round((Date.now() - started) / 1000)}s and recorded as a timeout`)
      room.raw.close()
    }

    // 7. Three failed runs pause the routine. The agent here has no fake model and no credential.
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
