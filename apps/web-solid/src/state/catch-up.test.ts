import { type AgentSlug, type RunStep } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { settledSteps } from "../chat/run/run-log"
import { typingOnStatus } from "./live-status"
import { heardThought, settledThoughts, thoughtMs } from "./thoughts"

const step = (slug: string, status: RunStep["status"], id = `${slug}-1`): RunStep => ({
  id,
  runId: "run-1",
  slug: slug as AgentSlug,
  tool: "run",
  name: "bash",
  label: "Ran a command",
  status,
  startedAt: 10,
  ...(status === "running" ? {} : { endedAt: 20 }),
  after: 3,
})

describe("catching up after the tab was in the background", () => {
  it("keeps typing only while the chat list is live, because a fresh subscribe re-announces who is typing", () => {
    const typing = { r1: { names: ["Kiko"], since: 10 } }
    expect(typingOnStatus(typing, "synchronizing")).toEqual({})
    expect(typingOnStatus(typing, "cached")).toEqual({})
    expect(typingOnStatus(typing, "live")).toEqual(typing)
  })

  it("drops every step the background tab left running, because the fresh subscribe re-announces the ones that still run", () => {
    const steps = [step("kiko", "done"), step("kiko", "running", "kiko-2"), step("juno", "failed")]
    expect(settledSteps(steps).map((each) => each.id)).toEqual(["kiko-1", "juno-1"])
    expect(settledSteps([])).toEqual([])
  })

  it("stops a thought the background tab left open, so its clock cannot keep running", () => {
    const open = heardThought(
      undefined,
      { slug: "kiko", runId: "run-1", part: 0, text: "Quiet first.", done: false },
      1_000,
      4,
    )
    const settled = settledThoughts({ kiko: [open] }, 6_000)
    const ended = settled.kiko?.[0]
    expect(ended?.openSince).toBeNull()
    expect(ended === undefined ? undefined : thoughtMs(ended, 60_000)).toBe(5_000)
  })
})
