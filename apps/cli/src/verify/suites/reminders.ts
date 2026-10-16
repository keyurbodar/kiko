import { agentTexts, newRoom, poll } from "../kit"
import { expectEqual, VerifyError } from "../client"
import { inSeconds, ok, type Routine, routines, runsOf, waitRuns } from "../routine-kit"
import type { Suite } from "../runner"
import { fake } from "./mid-run"

function wall(at: number, tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "medium" }).format(at)
}

// A reminder is a one-time routine: it runs once at its time, and a repeating one moves a day in its zone.
const suite: Suite = {
  name: "reminders",
  async run(v) {
    const s = await v.as(`reminders-${Date.now()}`)
    const url = v.url
    const { roomId, room } = await newRoom(s, "reminders check")
    await fake(v, s, roomId)
    const find = async (id: string) => (await routines(url, s)).routines.find((r) => r.id === id)

    const once = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "stretch", instructions: "[reply] time to stretch", trigger: { on: "time", at: inSeconds(3) } })
    await poll("the reminder's answer", () => agentTexts(room).some((t) => t.includes("time to stretch")), 30_000)
    await waitRuns(url, s, once.routine.id, "the run to end", (rs) => rs.some((x) => x.status === "ok"), 30_000)
    await Bun.sleep(2_000)
    const runs = await runsOf(url, s, once.routine.id)
    if (runs.length !== 1) throw new VerifyError(`a one-time routine ran ${runs.length} times: ${JSON.stringify(runs)}`)
    if (agentTexts(room).filter((t) => t.includes("time to stretch")).length !== 1) throw new VerifyError("a one-time routine answered twice")
    if (await find(once.routine.id)) throw new VerifyError("a finished one-time routine is still listed as live")

    const tz = "UTC"
    const daily = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "water the plants", instructions: "[reply] water the plants", trigger: { on: "time", at: inSeconds(3), rrule: "FREQ=DAILY" } })
    await waitRuns(url, s, daily.routine.id, "the daily run", (rs) => rs.some((x) => x.status === "ok"), 30_000)
    const moved = await poll("the daily row to move", async () => {
      const r = await find(daily.routine.id)
      return r && r.dueUtc > daily.routine.dueUtc ? r : undefined
    }, 10_000)
    expectEqual(moved.status, "active", "the daily status")
    const [beforeDay, beforeTime] = wall(daily.routine.dueUtc, tz).split(" ")
    const [afterDay, afterTime] = wall(moved.dueUtc, tz).split(" ")
    expectEqual(afterTime, beforeTime, "the local time of the next occurrence")
    const next = new Date(`${beforeDay}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    expectEqual(afterDay, next.toISOString().slice(0, 10), "the local day of the next occurrence")
    await ok(url, s, `routines/${daily.routine.id}/cancel`, {})
    console.log("  ok a one-time routine ran once and left the list; a daily one moved a day and was cancelled")
    room.raw.close()
  },
}

export default suite
