import type { RoomId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import type { Reminder, RunDelivery } from "../../user/reminders"
import { type RoutinesPort, routinesExtension } from "./routines"

const routine = (target: string): Reminder => ({
  id: "r1",
  text: "check the radar app",
  dueUtc: 0,
  tz: "UTC",
  rrule: null,
  roomId: "room" as RoomId,
  target,
  createdBy: "juno",
  status: "active",
  lastFired: null,
  name: "radar check",
  trigger: { on: "time", at: "2026-10-27T08:00:00Z" },
  fails: 0,
})

function port(target: string, ran: RunDelivery | null): RoutinesPort {
  return {
    list: async () => [routine(target)],
    runs: async () => [],
    runRoutine: async () => ran,
    self: () => "juno",
  } as unknown as RoutinesPort
}

async function runNow(p: RoutinesPort): Promise<string> {
  const tool = routinesExtension(() => p).tools?.find((t) => t.name === "update_routine")
  if (!tool) throw new Error("update_routine missing")
  const execute = tool.execute as unknown as (args: unknown) => Promise<{ output: { text: string }[] }>
  const out = await execute({ id: "r1", run_now: true })
  return out.output.map((o) => o.text).join("")
}

describe("update_routine run_now", () => {
  it("tells the caller to end its turn when the routine runs as itself", async () => {
    const text = await runNow(port("juno", "delivered"))

    expect(text).toContain(
      "run now: queued. it runs after you end this turn and its result comes to you then. end your turn now; do not poll or sleep.",
    )
  })

  it("says another agent got the run and answers later", async () => {
    expect(await runNow(port("mira", "delivered"))).toContain("run now: delivered to @mira. its reply arrives later")
  })

  it("says an inactive routine did not run", async () => {
    expect(await runNow(port("juno", null))).toContain("run now: not run: it is not active")
  })
})

describe("create_routine trigger", () => {
  it("turns a stringified reminder with in_seconds into a time trigger before validation", () => {
    const tool = routinesExtension(() => null).tools?.find((t) => t.name === "create_routine")
    const prepared = tool?.prepareArguments?.({
      name: "stretch",
      instructions: "tell the human to stretch",
      trigger: '{"on":"time","in_seconds":600,"rrule":null}',
    }) as { trigger: Record<string, unknown> }

    expect(Object.keys(prepared.trigger).sort()).toEqual(["at", "on"])
    expect(Date.parse(String(prepared.trigger.at))).toBeGreaterThan(0)
  })
})
