import { agentTexts, messages, newRoom, poll } from "../kit"
import type { UserToClient } from "@kiko/protocol"
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
      const a = await v.as(`proactive-pass-${run}`)
      const { roomId, room } = await newRoom(a, "proactive: daily pass")
      await fake(v, a, roomId)
      room.raw.send({ t: "task", op: { op: "create", id: "taxes", title: "file the tax return" } })
      await room.expect((f) => f.t === "events" && f.events.some((e) => e.t === "task" && e.task.id === "taxes"))
      // The room reports its board to UserDO after the task event, and the pass reads that report.
      await Bun.sleep(1_000)
      await dev(url, a, "age", { roomId, ms: 5 * 86_400_000 })
      await Bun.sleep(1_500)
      type P = { woke: { result: string }[] }
      const before = agentTexts(room).length
      const first = (await dev(url, a, "pass", {})) as P
      if (first.woke.length !== 1 || first.woke[0]?.result !== "delivered") throw new VerifyError(`the daily pass woke ${JSON.stringify(first.woke)}, want one delivered wake`)
      await poll("the nudge", () => agentTexts(room).length > before, 30_000)
      const answer = must(messages(room).filter((m) => m.from.kind === "agent").at(-1), "the nudge")
      if (!answer.text.includes("file the tax return")) throw new VerifyError(`the nudge was not about the task that is stale: ${JSON.stringify(answer.text)}`)
      if (!answer.initiative?.reason) throw new VerifyError(`the nudge has no initiative reason: ${JSON.stringify(answer)}`)
      await Bun.sleep(2_000)
      const second = (await dev(url, a, "pass", {})) as P
      if (second.woke.length) throw new VerifyError(`a task was nudged twice in three days: ${JSON.stringify(second.woke)}`)
      console.log(`  ok the daily pass nudged the stale task once (${JSON.stringify(answer.initiative.reason)}) and left it alone after that`)
      room.raw.close()
    }

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
      const kroom = await a.room(kikoChat)
      await fake(v, a, kikoChat)
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
      console.log("  ok away 8 days: the run was held and the kiko chat said why once; after a hello the next run ran")
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
