import type { Agent, AgentSlug, RoomId, RoomToClient, UserToClient } from "@yuki/protocol"
import { type RoomHandle, VerifyError } from "../client"
import { agentTexts, dev, eventually, inSeconds, messages, ok, type Routine, routines, systemTexts, toolLine, waitRuns } from "../routine-kit"
import type { Suite } from "../runner"
import { fake, newRoom, send, ulid } from "./mid-run"

// Architecture sections 25.3, 25.5, and 26.6, with the scripted fake agent: no tokens. A task left
// two days wakes its owner once through the initiative pass; a human away for a week holds every run
// nobody asked for and hears why once; no check-in routine exists, and yuki's overview reads every chat; work a
// routine hands to a teammate keeps the routine's authority, so the teammate cannot act outside yuki
// without the human, while the same hand-off from a human can. Needs NODE_ENV=development.

const agentOf = (name: string, run: string): Agent => ({ id: `proactive-${run}-${name}`, name, slug: name as AgentSlug, prompt: "", model: "opencode-go/deepseek-v4.1-flash" })

const suite: Suite = {
  name: "proactive",
  async run(v) {
    const run = String(Date.now())
    const s = await v.as(`proactive-${run}`)
    const url = v.url

    // 1. A stalled task: the initiative pass wakes its owner once, and the answer carries the reason.
    {
      const { roomId, room } = await newRoom(s, "proactive: stalls")
      await fake(v, s, roomId)
      await send(room, "[reply] ok")
      await eventually("the first answer", () => agentTexts(room).length >= 1, 20_000)
      room.raw.send({ t: "task", op: { op: "create", id: "stuck", title: "write the launch post", owner: "yuki" as AgentSlug } })
      room.raw.send({ t: "task", op: { op: "update", id: "stuck", status: "doing" } })
      await Bun.sleep(1_000)
      const before = agentTexts(room).length
      await dev(url, s, "attention", { action: "rhythm", mode: "now" })
      await dev(url, s, "age", { roomId, ms: 2 * 86_400_000 })
      // The human wrote a moment ago: the pass waits for them to leave the room.
      await dev(url, s, "attention", { action: "age", ms: 10 * 60_000 })
      const pass = await dev(url, s, "attention", { action: "pass" })
      await eventually("the woken owner's answer", () => agentTexts(room).length > before, 30_000).catch((e: Error) => {
        throw new VerifyError(`${e.message}: ${JSON.stringify(pass)}`)
      })
      const answer = messages(room).filter((m) => m.from.kind === "agent").at(-1)!
      if (!answer.text.includes("write the launch post")) throw new VerifyError(`the wake did not reach the owner: ${JSON.stringify(answer.text)}`)
      if (!answer.initiative?.reason) throw new VerifyError(`the answer to a wake has no initiative reason: ${JSON.stringify(answer)}`)
      // A second pass with the task untouched: the same stretch of staleness rests.
      await Bun.sleep(2_000)
      await dev(url, s, "attention", { action: "pass" })
      await Bun.sleep(4_000)
      if (agentTexts(room).length !== before + 1) throw new VerifyError(`a task was woken twice for one stretch of staleness: ${JSON.stringify(agentTexts(room).slice(before))}`)
      console.log(`  ok a task untouched for 2 days woke its owner once (${JSON.stringify(answer.initiative.reason)}): ${JSON.stringify(answer.text.slice(0, 80))}`)
      room.raw.close()
    }

    // 1b. Two ignored nudges close the appetite: no third, and the loop rests longer each time.
    {
      const a = await v.as(`proactive-ignore-${run}`)
      const { roomId, room } = await newRoom(a, "proactive: ignored")
      await fake(v, a, roomId)
      const due = new Date(Date.now() + 86_400_000).toISOString()
      await send(room, toolLine("loop", { action: "open", kind: "intention", certainty: "explicit", text: "file the tax return", due_iso: due }))
      await eventually("the loop", () => agentTexts(room).length >= 1, 20_000)
      await dev(url, a, "attention", { action: "rhythm", mode: "now" })
      type P = { woke: { result: string }[]; verdicts: { verdict: string; reason?: string; until?: number }[]; at: number }
      const step = async (days: number) => {
        await dev(url, a, "attention", { action: "age", ms: days * 86_400_000 })
        const before = agentTexts(room).length
        const p = (await dev(url, a, "attention", { action: "pass" })) as P
        if (p.woke.some((w) => w.result === "delivered")) await eventually("the nudge", () => agentTexts(room).length > before, 20_000)
        await Bun.sleep(2_000)
        const v0 = p.verdicts[0]!
        return { woke: p.woke.filter((w) => w.result === "delivered").length, verdict: `${v0.verdict}${v0.reason ? `:${v0.reason}` : ""}${v0.until ? ` ${((v0.until - p.at) / 86_400_000).toFixed(1)}d` : ""}` }
      }
      const got = [await step(1), await step(2), await step(2), await step(2), await step(4)]
      const want = [1, 0, 1, 0, 0]
      if (got.map((g) => g.woke).join() !== want.join()) throw new VerifyError(`nudges per pass ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
      console.log(`  ok nudge, ignored, rest, nudge, ignored, then none: ${got.map((g) => g.verdict).join(" | ")}`)
      room.raw.close()
    }

    // 2. Away for 8 days: runs are held, the yuki chat says so once, and opening yuki resumes them.
    {
      const a = await v.as(`proactive-away-${run}`)
      await ok(url, a, "me")
      const user = await a.user()
      const yukiChat = await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new VerifyError("no yuki chat in the snapshot")), 5_000)
        const look = () => {
          for (const e of user.log) {
            const f = e.frame as UserToClient
            if (e.dir === "in" && f.t === "reset") {
              const k = f.snapshot.chats.find((c) => c.yuki)
              if (k) return (clearTimeout(t), resolve(k.roomId))
            }
          }
          setTimeout(look, 100)
        }
        look()
      })
      const kroom = await a.room(yukiChat)
      await fake(v, a, yukiChat)
      const { roomId, room } = await newRoom(a, "proactive: away")
      await fake(v, a, roomId)
      await dev(url, a, "seen", { ago: 8 * 86_400_000 })
      const { routine } = await ok<{ routine: Routine }>(url, a, "routines", { roomId, name: "while away", instructions: "[reply] ran", trigger: { on: "time", at: inSeconds(3) } })
      const held = await waitRuns(url, a, routine.id, "a held run", (rs) => rs.length > 0, 40_000)
      if (held[0]!.status !== "held") throw new VerifyError(`a run started while the human was away: ${JSON.stringify(held)}`)
      await eventually("the away line", () => systemTexts(kroom).some((t) => t.includes("while you were away")), 10_000)
      if (agentTexts(room).length) throw new VerifyError("an agent answered while the human was away")
      // Opening yuki again (a socket hello) resumes.
      await dev(url, a, "seen", { ago: 2 * 3_600_000 })
      ;(await a.user()).send({ t: "hello", lastSeq: 0 })
      const { routine: next } = await ok<{ routine: Routine }>(url, a, "routines", { roomId, name: "after return", instructions: "[reply] back", trigger: { on: "time", at: inSeconds(3) } })
      const back = await waitRuns(url, a, next.id, "a run after return", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      if (back[0]!.status !== "ok") throw new VerifyError(`a run after the human came back did not run: ${JSON.stringify(back)}`)
      console.log("  ok away 8 days: the run was held and the yuki chat said why once; after a hello the next run ran")
      room.raw.close()
      kroom.raw.close()
    }

    // 3. No daily check-in routine is made any more, and yuki's overview still reads across chats.
    {
      await ok(url, s, "me")
      await ok(url, s, "me")
      const count = (await routines(url, s)).routines.filter((r) => r.name === "check-in").length
      if (count !== 0) throw new VerifyError(`ensureHome made ${count} check-in routines`)
      const { roomId, room } = await newRoom(s, "proactive: overview")
      await fake(v, s, roomId)
      room.raw.send({ t: "task", op: { op: "create", id: "open-1", title: "book the venue" } })
      await Bun.sleep(1_500)
      await send(room, toolLine("overview", {}))
      await eventually("the overview result", () => agentTexts(room).some((t) => t.includes("chats, newest first")), 20_000)
      const text = agentTexts(room).find((t) => t.includes("chats, newest first"))!
      if (!text.includes("proactive: overview") || !text.includes("open task")) throw new VerifyError(`the overview missed something: ${text.slice(0, 600)}`)
      console.log(`  ok no check-in routine; overview lists chats and open tasks (${text.length} chars)`)
      room.raw.close()
    }

    // 4. Authority survives a hand-off. A routine's run hands work to @ada: ada cannot act outside yuki
    //    without the human. The human handing the same work to ada through yuki: ada can.
    {
      const user = await s.user()
      // Two agents make a group, which yuki leads (section 7.11), so yuki is the one who hands off.
      for (const name of ["ada", "bob"]) user.send({ t: "agent", op: { op: "create", agent: agentOf(name, run) } })
      const roomId = ulid() as RoomId
      user.send({ t: "chat", op: { op: "create", roomId, title: "proactive: hand-off", agents: [agentOf("ada", run).id, agentOf("bob", run).id] } })
      await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
      const room = await s.room(roomId)
      await ok(url, s, "dev/agent/fake", { roomId, slugs: ["yuki", "ada", "bob"] })
      // A human hand-off first: yuki sends ada the work, ada runs fake_send.
      await send(room, "[send ada] [call fake_send]")
      await eventually("ada's answer to the human's hand-off", () => messages(room).some((m) => m.from.kind === "agent" && m.from.slug === "ada" && m.text.startsWith("tools:")), 30_000)
      const fromHuman = messages(room).find((m) => m.from.kind === "agent" && m.from.slug === "ada" && m.text.startsWith("tools:"))!.text
      if (fromHuman !== "tools: fake_send ran") throw new VerifyError(`a human's hand-off was blocked: ${fromHuman}`)
      // Now a routine of yuki's hands the same work to ada.
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "hand off", instructions: "[send ada] [call fake_send]", trigger: { on: "time", at: inSeconds(3) } })
      await waitRuns(url, s, routine.id, "the routine's run", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      await eventually("ada's answer to the routine's hand-off", () => messages(room).filter((m) => m.from.kind === "agent" && m.from.slug === "ada" && m.text.startsWith("tools:")).length >= 2, 30_000)
      const fromRoutine = messages(room).filter((m) => m.from.kind === "agent" && m.from.slug === "ada" && m.text.startsWith("tools:"))[1]!.text
      if (fromRoutine !== "tools: fake_send blocked") throw new VerifyError(`a routine's hand-off let ada act outside yuki: ${fromRoutine}`)
      console.log("  ok the human's hand-off let ada run fake_send; a routine's identical hand-off was blocked")
      room.raw.close()
    }
  },
}

export default suite
