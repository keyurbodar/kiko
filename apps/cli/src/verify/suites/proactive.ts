import type { Agent, AgentSlug, Approval, RoomId, RoomToClient, UserToClient } from "@kiko/protocol"
import { type RoomHandle, VerifyError } from "../client"
import { agentTexts, dev, eventually, inSeconds, messages, ok, type Routine, routines, systemTexts, toolLine, waitRoutine, waitRuns } from "../routine-kit"
import type { Suite } from "../runner"
import { fake, newRoom, send, ulid } from "./mid-run"

// Architecture sections 25.3, 25.5, 25.6, and 25.7, with the scripted fake agent: no tokens. A task
// left a day is nudged once to its owner; a human away for a week holds every run nobody asked for
// and hears why once; every user has kiko's check-in, and kiko's overview reads every chat; work a
// routine hands to a teammate keeps the routine's authority, so the teammate cannot act outside kiko
// without the human, while the same hand-off from a human can. Needs NODE_ENV=development.

function cards(room: RoomHandle): Approval[] {
  return room.raw.log.flatMap((e) => {
    if (e.dir !== "in") return []
    const f = e.frame as RoomToClient
    return f.t === "events" ? f.events.flatMap((ev) => (ev.t === "approval" ? [ev.approval] : [])) : []
  })
}

const agentOf = (name: string, run: string): Agent => ({ id: `proactive-${run}-${name}`, name, slug: name as AgentSlug, prompt: "", model: "opencode-go/deepseek-v4.1-flash" })

const suite: Suite = {
  name: "proactive",
  async run(v) {
    const run = String(Date.now())
    const s = await v.as(`proactive-${run}`)
    const url = v.url

    // 1. A stalled task: one nudge to its owner, once a day.
    {
      const { roomId, room } = await newRoom(s, "proactive: stalls")
      await fake(v, s, roomId)
      await send(room, "[reply] ok")
      await eventually("the first answer", () => agentTexts(room).length >= 1, 20_000)
      room.raw.send({ t: "task", op: { op: "create", id: "stuck", title: "write the launch post", owner: "kiko" as AgentSlug } })
      room.raw.send({ t: "task", op: { op: "update", id: "stuck", status: "doing" } })
      await Bun.sleep(1_000)
      const before = agentTexts(room).length
      await dev(url, s, "age", { roomId, ms: 25 * 3_600_000 })
      await eventually("the nudged agent's answer", () => agentTexts(room).length > before, 30_000)
      const answer = agentTexts(room).at(-1)!
      if (!answer.includes("write the launch post")) throw new VerifyError(`the nudge did not reach the owner: ${JSON.stringify(answer)}`)
      // The sweep again, with the task untouched: the same stretch of staleness is not nudged twice.
      await dev(url, s, "age", { roomId, ms: 0 })
      await Bun.sleep(4_000)
      if (agentTexts(room).length !== before + 1) throw new VerifyError(`a task was nudged twice for one stretch of staleness: ${JSON.stringify(agentTexts(room).slice(before))}`)
      console.log(`  ok a task untouched for 25h nudged its owner once: ${JSON.stringify(answer.slice(0, 80))}`)
      room.raw.close()
    }

    // 2. Away for 8 days: runs are held, the kiko chat says so once, and opening kiko resumes them.
    {
      const a = await v.as(`proactive-away-${run}`)
      await ok(url, a, "me")
      const user = await a.user()
      const kikoChat = await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new VerifyError("no kiko chat in the snapshot")), 5_000)
        const look = () => {
          for (const e of user.log) {
            const f = e.frame as UserToClient
            if (e.dir === "in" && f.t === "reset") {
              const k = f.snapshot.chats.find((c) => c.kiko)
              if (k) return (clearTimeout(t), resolve(k.roomId))
            }
          }
          setTimeout(look, 100)
        }
        look()
      })
      const kroom = await a.room(kikoChat)
      await fake(v, a, kikoChat)
      const { roomId, room } = await newRoom(a, "proactive: away")
      await fake(v, a, roomId)
      await dev(url, a, "seen", { ago: 8 * 86_400_000 })
      const { routine } = await ok<{ routine: Routine }>(url, a, "routines", { roomId, name: "while away", instructions: "[reply] ran", trigger: { on: "time", at: inSeconds(3) } })
      const held = await waitRuns(url, a, routine.id, "a held run", (rs) => rs.length > 0, 40_000)
      if (held[0]!.status !== "held") throw new VerifyError(`a run started while the human was away: ${JSON.stringify(held)}`)
      await eventually("the away line", () => systemTexts(kroom).some((t) => t.includes("while you were away")), 10_000)
      if (agentTexts(room).length) throw new VerifyError("an agent answered while the human was away")
      // Opening kiko again (a socket hello) resumes.
      await dev(url, a, "seen", { ago: 2 * 3_600_000 })
      ;(await a.user()).send({ t: "hello", lastSeq: 0 })
      const { routine: next } = await ok<{ routine: Routine }>(url, a, "routines", { roomId, name: "after return", instructions: "[reply] back", trigger: { on: "time", at: inSeconds(3) } })
      const back = await waitRuns(url, a, next.id, "a run after return", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      if (back[0]!.status !== "ok") throw new VerifyError(`a run after the human came back did not run: ${JSON.stringify(back)}`)
      console.log("  ok away 8 days: the run was held and the kiko chat said why once; after a hello the next run ran")
      room.raw.close()
      kroom.raw.close()
    }

    // 3. kiko's check-in exists for every user, and overview reads across chats.
    {
      await ok(url, s, "me")
      const checkIn = await waitRoutine(url, s, (all) => all.find((r) => r.name === "check-in" && r.target === "kiko"), "the check-in routine", 10_000)
      if (checkIn.status !== "active" || checkIn.trigger?.on !== "time") throw new VerifyError(`unexpected check-in ${JSON.stringify(checkIn)}`)
      await ok(url, s, "me")
      const count = (await routines(url, s)).routines.filter((r) => r.name === "check-in").length
      if (count !== 1) throw new VerifyError(`ensureHome made ${count} check-ins`)
      const { roomId, room } = await newRoom(s, "proactive: overview")
      await fake(v, s, roomId)
      room.raw.send({ t: "task", op: { op: "create", id: "open-1", title: "book the venue" } })
      await Bun.sleep(1_500)
      await send(room, toolLine("overview", {}))
      await eventually("the overview result", () => agentTexts(room).some((t) => t.includes("chats, newest first")), 20_000)
      const text = agentTexts(room).find((t) => t.includes("chats, newest first"))!
      if (!text.includes("proactive: overview") || !text.includes("open task") || !text.includes("check-in")) throw new VerifyError(`the overview missed something: ${text.slice(0, 600)}`)
      console.log(`  ok every user has kiko's check-in (${checkIn.id}, once), and overview lists chats, open tasks, and routines (${text.length} chars)`)
      room.raw.close()

      // A scheduled check-in with nothing changed since its last run calls no model. The client opens
      // the kiko chat, which gives its room a home.
      const kroom = await s.room(checkIn.roomId)
      await ok(url, s, "dev/agent/fake", { roomId: checkIn.roomId })
      await dev(url, s, "due", { id: checkIn.id })
      await waitRuns(url, s, checkIn.id, "the first scheduled check-in", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      await dev(url, s, "due", { id: checkIn.id })
      const runs = await waitRuns(url, s, checkIn.id, "the second scheduled check-in", (rs) => rs.filter((x) => x.status !== "running").length >= 2, 40_000)
      if (runs[0]!.status !== "quiet" || runs[0]!.seq !== null) throw new VerifyError(`an unchanged check-in still ran: ${JSON.stringify(runs.slice(0, 2))}`)
      if (runs[1]!.status !== "ok") throw new VerifyError(`the first check-in did not run: ${JSON.stringify(runs[1])}`)
      console.log(`  ok a check-in with nothing new was recorded quiet with no delivery (first ${runs[1]!.status}, then ${runs[0]!.status})`)
      kroom.raw.close()
    }

    // 4. Authority survives a hand-off. A routine's run hands work to @ada: ada cannot act outside kiko
    //    without the human. The human handing the same work to ada through kiko: ada can.
    {
      const user = await s.user()
      // Two agents make a group, which kiko leads (section 7.11), so kiko is the one who hands off.
      for (const name of ["ada", "bob"]) user.send({ t: "agent", op: { op: "create", agent: agentOf(name, run) } })
      const roomId = ulid() as RoomId
      user.send({ t: "chat", op: { op: "create", roomId, title: "proactive: hand-off", agents: [agentOf("ada", run).id, agentOf("bob", run).id] } })
      await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
      const room = await s.room(roomId)
      await ok(url, s, "dev/agent/fake", { roomId, slugs: ["kiko", "ada", "bob"] })
      // A human hand-off first: kiko sends ada the work, ada runs fake_send.
      await send(room, "[send ada] [call fake_send]")
      await eventually("ada's answer to the human's hand-off", () => messages(room).some((m) => m.from.kind === "agent" && m.from.slug === "ada" && m.text.startsWith("tools:")), 30_000)
      const fromHuman = messages(room).find((m) => m.from.kind === "agent" && m.from.slug === "ada" && m.text.startsWith("tools:"))!.text
      if (fromHuman !== "tools: fake_send ran") throw new VerifyError(`a human's hand-off was blocked: ${fromHuman}`)
      // Now a routine of kiko's hands the same work to ada.
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "hand off", instructions: "[send ada] [call fake_send]", trigger: { on: "time", at: inSeconds(3) } })
      await waitRuns(url, s, routine.id, "the routine's run", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      await eventually("ada's answer to the routine's hand-off", () => messages(room).filter((m) => m.from.kind === "agent" && m.from.slug === "ada" && m.text.startsWith("tools:")).length >= 2, 30_000)
      const fromRoutine = messages(room).filter((m) => m.from.kind === "agent" && m.from.slug === "ada" && m.text.startsWith("tools:"))[1]!.text
      if (fromRoutine !== "tools: fake_send blocked") throw new VerifyError(`a routine's hand-off let ada act outside kiko: ${fromRoutine}`)
      if (!cards(room).some((c) => c.tool === "fake_send" && c.slug === "ada")) throw new VerifyError("ada's blocked call posted no card")
      console.log("  ok the human's hand-off let ada run fake_send; a routine's identical hand-off was blocked with a card")
      room.raw.close()
    }
  },
}

export default suite
