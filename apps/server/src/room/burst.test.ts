import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import type { AgentSlug, Envelope, RoomId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { Burst } from "./burst"
import type { RoomLog } from "./log"
import type { Members } from "./members"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug

function burst(log: Partial<RoomLog> = {}) {
  return new Burst(
    {} as DurableObjectStorage,
    ROOM,
    {} as Alarms,
    log as unknown as RoomLog,
    { list: () => [{ slug: KIKO }] } as unknown as Members,
  )
}

const envelope = (seq: number): Envelope => ({
  id: `human:m${seq}`,
  roomId: ROOM as RoomId,
  from: { kind: "human" },
  body: "hi",
  hop: 0,
  rootId: `m${seq}`,
  seq,
})

describe("a burst flush", () => {
  it("joins the flush already running instead of running a second one", async () => {
    const b = burst()
    const runs: number[] = []
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = async (n: number) => {
      runs.push(n)
      if (n === 1) await gate
    }

    const first = b.flush(() => run(1))
    const second = b.flush(() => run(2))
    expect(runs).toEqual([1])

    release()
    await Promise.all([first, second])
    expect(runs).toEqual([1])

    await b.flush(() => run(3))
    expect(runs).toEqual([1, 3])
  })

  it("flushes again after one fails", async () => {
    const b = burst()
    await expect(b.flush(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom")

    let ran = false
    await b.flush(async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })
})

describe("an agent's pending envelopes", () => {
  it("asks for no more rows than it returns, past everything already admitted", () => {
    const asked: { slug: AgentSlug; after: number; limit: number }[] = []
    const b = burst({
      unansweredFor: (slug: AgentSlug, after: number, limit = 200) => {
        asked.push({ slug, after, limit })
        return []
      },
    })

    b.forAgent(KIKO, 3)
    b.accepted(KIKO, [envelope(7)])
    b.forAgent(KIKO, 3)

    expect(asked).toEqual([
      { slug: KIKO, after: 0, limit: 3 },
      { slug: KIKO, after: 7, limit: 3 },
    ])
  })
})
