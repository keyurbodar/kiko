import { describe, expect, it } from "vitest"
import { withRetryAfter } from "./retry"

const NOW = Date.parse("2026-10-26T12:00:00Z")
const URL = "https://api.example.com"

function provider(replies: Response[]) {
  const gates = new Map<string, number>()
  const clock = { now: NOW }
  let calls = 0
  const egress = (async () => {
    calls++
    return replies.shift() ?? new Response("{}", { status: 200 })
  }) as unknown as typeof fetch
  const through = withRetryAfter(egress, "claude", gates, () => clock.now)
  return { through, gates, clock, calls: () => calls }
}

const rejected = (reset: string, claim = "five_hour") =>
  new Response("{}", {
    status: 429,
    headers: {
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-5h-status": "rejected",
      "anthropic-ratelimit-unified-5h-reset": reset,
      "anthropic-ratelimit-unified-representative-claim": claim,
    },
  })

describe("withRetryAfter", () => {
  it("names when a long limit resets", async () => {
    const p = provider([rejected("2026-10-26T14:05:00Z")])
    const response = await p.through("opus")(URL)

    expect(response.status).toBe(400)
    expect(await response.text()).toContain("resets_at=2026-10-26T14:05:00.000Z")
  })

  it("passes a short wait through", async () => {
    const p = provider([new Response("{}", { status: 429, headers: { "retry-after": "1" } })])

    expect((await p.through("opus")(URL)).status).toBe(429)
  })

  it("fails the next call at once while a known account limit holds, for every model", async () => {
    const p = provider([rejected("2026-10-26T14:05:00Z")])
    await p.through("opus")(URL)
    const next = await p.through("haiku")(URL)

    expect(p.calls()).toBe(1)
    expect(next.status).toBe(400)
    expect(await next.text()).toContain("resets_at=2026-10-26T14:05:00.000Z")
  })

  it("holds a model limit only for that model", async () => {
    const p = provider([rejected("2026-10-26T14:05:00Z", "seven_day_opus")])
    await p.through("opus")(URL)

    expect((await p.through("haiku")(URL)).status).toBe(200)
    expect((await p.through("opus")(URL)).status).toBe(400)
    expect(p.calls()).toBe(2)
  })

  it("calls out again once the reset passes, and clears the gate on success", async () => {
    const p = provider([rejected("2026-10-26T14:05:00Z")])
    await p.through("opus")(URL)
    p.clock.now = Date.parse("2026-10-26T14:05:01Z")

    expect((await p.through("opus")(URL)).status).toBe(200)
    expect(p.calls()).toBe(2)
    expect(p.gates.size).toBe(0)
  })
})
