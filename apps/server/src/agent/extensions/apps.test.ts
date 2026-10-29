import { describe, expect, it } from "vitest"
import type { AppSummary, DeployOutcome } from "../../apps/service"
import { appLine, deployReport } from "./apps"

const NOW = Date.parse("2026-10-26T12:00:00.000Z")
const app = (expiresAt: string) => ({
  name: "radar",
  url: "https://d1.lakebed.app",
  claimed: false,
  expired: false,
  expiresAt,
  updatedAt: NOW,
})
const claim = { url: "https://api.lakebed.dev/claim/d1/t", code: "CODE-1" }
const routineAt = (text: string) => Date.parse(/routine for yourself at (\S+) /.exec(text)?.[1] ?? "")

describe("deployReport", () => {
  it("asks for the claim and a reminder routine on the first deploy", () => {
    const out: DeployOutcome = { ok: true, app: app("2026-11-02T12:00:00.000Z"), changed: true, claim, live: 200 }

    const text = deployReport(out, NOW)

    expect(text).toContain("live (200)")
    expect(text).toContain("CODE-1")
    expect(routineAt(text)).toBe(Date.parse("2026-10-31T12:00:00.000Z"))
  })

  it("sets the reminder before expiry when the app expires within two days", () => {
    const out: DeployOutcome = { ok: true, app: app("2026-10-27T12:00:00.000Z"), changed: true, claim }

    const at = routineAt(deployReport(out, NOW))

    expect(at).toBeGreaterThan(NOW)
    expect(at).toBeLessThan(Date.parse("2026-10-27T12:00:00.000Z"))
  })

  it("gives a later deploy one line about expiry, with no claim ask or routine", () => {
    const out: DeployOutcome = { ok: true, app: app("2026-11-02T12:00:00.000Z"), changed: true, live: 200 }

    expect(deployReport(out, NOW)).toBe(
      "deployed: https://d1.lakebed.app (unclaimed, expires 2026-11-02T12:00:00.000Z)\nlive (200)",
    )
  })
})

describe("appLine", () => {
  it("tells the agent an expired app is down and how to bring it back", () => {
    const line = appLine({ ...app("2026-10-01T00:00:00.000Z"), expired: true } satisfies AppSummary)

    expect(line).toContain("expired and no longer live")
    expect(line).toContain("deploy it again")
    expect(line).toContain("claim_link")
  })

  it("gives an app that still has time its expiry date", () => {
    expect(appLine(app("2026-11-02T12:00:00.000Z"))).toBe(
      "radar: https://d1.lakebed.app (expires 2026-11-02T12:00:00.000Z)",
    )
  })
})
