import type { Models } from "@earendil-works/pi-ai"
import { describe, expect, it, vi } from "vitest"
import { providerSaid } from "./credentials-check"
import { probeVerdict } from "./provider-health"

const model = { id: "m", input: ["text"], reasoning: false, cost: { input: 0, output: 0 } }

const withModel = (completeSimple: () => Promise<unknown>): Models =>
  ({ getModels: () => [model], completeSimple }) as unknown as Models

describe("provider probe", () => {
  it("reports no probe when the provider offers no text model", async () => {
    const completeSimple = vi.fn()
    const said = await providerSaid({ getModels: () => [], completeSimple } as unknown as Models, "p")
    expect(said).toEqual({ ran: false })
    expect(completeSimple).not.toHaveBeenCalled()
  })

  it("tells a quiet probe from a provider error", async () => {
    expect(
      await providerSaid(
        withModel(async () => ({ stopReason: "stop" })),
        "p",
      ),
    ).toEqual({
      ran: true,
      said: null,
    })
    expect(
      await providerSaid(
        withModel(async () => ({ stopReason: "error", errorMessage: "401 unauthorized" })),
        "p",
      ),
    ).toEqual({ ran: true, said: "401 unauthorized" })
  })

  it("never clears a problem when no probe could run", () => {
    expect(probeVerdict({ ran: false }, "api_key")).toBe("keep")
  })

  it("clears a problem only when the provider answers", () => {
    expect(probeVerdict({ ran: true, said: null }, "api_key")).toBeNull()
    expect(probeVerdict({ ran: true, said: "401 unauthorized" }, "api_key")).toBe("key_refused")
  })
})
