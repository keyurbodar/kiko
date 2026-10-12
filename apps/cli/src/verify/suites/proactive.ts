import { agentTexts, messages, newRoom, poll } from "../kit"
import type { AgentSlug, UserToClient } from "@yuki/protocol"
import { VerifyError } from "../client"
import { dev, inSeconds, ok, type Routine, routines, systemTexts, toolLine, waitRuns } from "../routine-kit"
import { must } from "../must"
import type { Suite } from "../runner"
import { fake, send } from "./mid-run"


const suite: Suite = {
  name: "proactive",
  async run(v) {
    const run = String(Date.now())
    const s = await v.as(`proactive-${run}`)
    const url = v.url

    {
      const { roomId, room } = await newRoom(s, "proactive: stalls")
      await fake(v, s, roomId)
      await send(room, "[reply] ok")
      await poll("the first answer", () => agentTexts(room).length >= 1, 20_000)
      room.raw.send({ t: "task", op: { op: "create", id: "stuck", title: "write the launch post", owner: "yuki" as AgentSlug } })
      room.raw.send({ t: "task", op: { op: "update", id: "stuck", status: "doing" } })
      await Bun.sleep(1_000)
      const before = agentTexts(room).length
      await dev(url, s, "attention", { action: "rhythm", mode: "now" })
      await dev(url, s, "age", { roomId, ms: 2 * 86_400_000 })
      await dev(url, s, "attention", { action: "age", ms: 10 * 60_000 })
      const pass = await dev(url, s, "attention", { action: "pass" })
      await poll("the woken owner's answer", () => agentTexts(room).length > before, 30_000).catch((e: Error) => {
        throw new VerifyError(`${e.message}: ${JSON.stringify(pass)}`)
      })
      const answer = must(messages(room).filter((m) => m.from.kind === "agent").at(-1), "the woken owner's answer")
      if (!answer.text.includes("write the launch post")) throw new VerifyError(`the wake did not reach the owner: ${JSON.stringify(answer.text)}`)
      if (!answer.initiative?.reason) throw new VerifyError(`the answer to a wake has no initiative reason: ${JSON.stringify(answer)}`)
      await Bun.sleep(2_000)
      await dev(url, s, "attention", { action: "pass" })
      await Bun.sleep(4_000)
      if (agentTexts(room).length !== before + 1) throw new VerifyError(`a task was woken twice for one stretch of staleness: ${JSON.stringify(agentTexts(room).slice(before))}`)
      console.log(`  ok a task untouched for 2 days woke its owner once (${JSON.stringify(answer.initiative.reason)}): ${JSON.stringify(answer.text.slice(0, 80))}`)
      room.raw.close()
    }

    {
      const a = await v.as(`proactive-ignore-${run}`)
      const { roomId, room } = await newRoom(a, "proactive: ignored")
      await fake(v, a, roomId)
      const due = new Date(Date.now() + 86_400_000).toISOString()
      await dev(url, a, "loops", { open: { roomId, text: "file the tax return", due } })
      await dev(url, a, "attention", { action: "rhythm", mode: "now" })
      type P = { woke: { result: string }[]; verdicts: { verdict: string; reason?: string; until?: number }[]; at: number }
      const step = async (days: number) => {
        await dev(url, a, "attention", { action: "age", ms: days * 86_400_000 })
        const before = agentTexts(room).length
        const p = (await dev(url, a, "attention", { action: "pass" })) as P
        if (p.woke.some((w) => w.result === "delivered")) await poll("the nudge", () => agentTexts(room).length > before, 20_000)
        await Bun.sleep(2_000)
        const v0 = must(p.verdicts[0], "a verdict")
        return { woke: p.woke.filter((w) => w.result === "delivered").length, verdict: `${v0.verdict}${v0.reason ? `:${v0.reason}` : ""}${v0.until ? ` ${((v0.until - p.at) / 86_400_000).toFixed(1)}d` : ""}` }
      }
      // One ignore rests two cycles (two days here), and the next ignore doubles it to four. The third step is past the first rest but inside a three-day one.
      const got = [await step(1), await step(1.5), await step(1), await step(2), await step(4)]
      const want = [1, 0, 1, 0, 0]
      if (got.map((g) => g.woke).join() !== want.join()) throw new VerifyError(`nudges per pass ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
      console.log(`  ok nudge, rest after an ignore, nudge, rest after a second ignore, then none: ${got.map((g) => g.verdict).join(" | ")}`)
      room.raw.close()
    }

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
              if (k) {
                clearTimeout(t)
                resolve(k.roomId)
                return
              }
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
      if (held[0]?.status !== "held") throw new VerifyError(`a run started while the human was away: ${JSON.stringify(held)}`)
      await poll("the away line", () => systemTexts(kroom).some((t) => t.includes("while you were away")), 10_000)
      if (agentTexts(room).length) throw new VerifyError("an agent answered while the human was away")
      await dev(url, a, "seen", { ago: 2 * 3_600_000 })
      ;(await a.user()).send({ t: "hello", lastSeq: 0 })
      const { routine: next } = await ok<{ routine: Routine }>(url, a, "routines", { roomId, name: "after return", instructions: "[reply] back", trigger: { on: "time", at: inSeconds(3) } })
      const back = await waitRuns(url, a, next.id, "a run after return", (rs) => rs.some((x) => x.status !== "running"), 40_000)
      if (back[0]?.status !== "ok") throw new VerifyError(`a run after the human came back did not run: ${JSON.stringify(back)}`)
      console.log("  ok away 8 days: the run was held and the yuki chat said why once; after a hello the next run ran")
      room.raw.close()
      kroom.raw.close()
    }

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
      await poll("the overview result", () => agentTexts(room).some((t) => t.includes("chats, newest first")), 20_000)
      const text = must(agentTexts(room).find((t) => t.includes("chats, newest first")), "the overview result")
      if (!text.includes("proactive: overview") || !text.includes("open task")) throw new VerifyError(`the overview missed something: ${text.slice(0, 600)}`)
      console.log(`  ok no check-in routine; overview lists chats and open tasks (${text.length} chars)`)
      room.raw.close()
    }
  },
}

export default suite
