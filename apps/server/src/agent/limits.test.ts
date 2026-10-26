import { describe, expect, it } from "vitest"
import { limitOf } from "./limits"

const NOW = Date.parse("2026-10-26T12:00:00Z")
const at = (iso: string) => Date.parse(iso)

describe("limitOf from headers", () => {
  it("reads a rejected Claude 5-hour window and its reset", () => {
    const reset = at("2026-10-26T14:05:00Z") / 1000
    expect(
      limitOf({
        status: 429,
        headers: {
          "anthropic-ratelimit-unified-status": "rejected",
          "anthropic-ratelimit-unified-5h-status": "rejected",
          "anthropic-ratelimit-unified-5h-reset": String(reset),
          "retry-after": "30",
        },
        now: NOW,
      }),
    ).toEqual({ scope: "account", resetAt: at("2026-10-26T14:05:00Z") })
  })

  it("marks a rejected 7-day window as long and a model claim as the model's", () => {
    expect(
      limitOf({
        status: 429,
        headers: new Headers({
          "Anthropic-Ratelimit-Unified-7d-Status": "rejected",
          "anthropic-ratelimit-unified-7d-reset": "2026-10-30T00:00:00Z",
          "anthropic-ratelimit-unified-representative-claim": "seven_day_opus",
        }),
        now: NOW,
      }),
    ).toEqual({ scope: "model", resetAt: at("2026-10-30T00:00:00Z"), long: true })
  })

  it("takes the later of two full Codex windows", () => {
    expect(
      limitOf({
        status: 429,
        headers: {
          "x-codex-primary-used-percent": "100",
          "x-codex-primary-reset-after-seconds": "600",
          "x-codex-secondary-used-percent": "100",
          "x-codex-secondary-window-minutes": "10080",
          "x-codex-secondary-reset-at": String(at("2026-10-28T09:00:00Z") / 1000),
        },
        now: NOW,
      }),
    ).toEqual({ scope: "account", resetAt: at("2026-10-28T09:00:00Z"), long: true })
  })

  it("reads retry-after in seconds and as a date", () => {
    expect(limitOf({ status: 429, headers: { "retry-after": "120" }, now: NOW })).toEqual({
      scope: "request",
      resetAt: NOW + 120_000,
    })
    expect(
      limitOf({ status: 429, headers: { "retry-after": "Mon, 26 Oct 2026 13:00:00 GMT" }, now: NOW })?.resetAt,
    ).toBe(at("2026-10-26T13:00:00Z"))
  })

  it("waits for the exhausted x-ratelimit window", () => {
    expect(
      limitOf({
        status: 429,
        headers: {
          "x-ratelimit-remaining-requests": "5",
          "x-ratelimit-reset-requests": "2s",
          "x-ratelimit-remaining-tokens": "0",
          "x-ratelimit-reset-tokens": "6m30s",
        },
        now: NOW,
      })?.resetAt,
    ).toBe(NOW + 390_000)
  })

  it("is nothing for a plain error without limit headers or words", () => {
    expect(limitOf({ status: 500, headers: {}, message: "internal error", now: NOW })).toBeNull()
  })
})

describe("limitOf from text", () => {
  it("reads resets_in_seconds out of a body", () => {
    expect(limitOf({ message: '{"error":{"type":"usage_limit_reached","resets_in_seconds":1800}}', now: NOW })).toEqual(
      { scope: "account", resetAt: NOW + 1_800_000 },
    )
  })

  it("reads try again in ~N min", () => {
    expect(limitOf({ message: "Rate limit reached. Please try again in ~5 min.", now: NOW })?.resetAt).toBe(
      NOW + 300_000,
    )
  })

  it("reads an unquoted resets_at time", () => {
    expect(limitOf({ message: "wait too long. resets_at=2026-10-26T14:05:00.000Z", now: NOW })?.resetAt).toBe(
      at("2026-10-26T14:05:00Z"),
    )
  })

  it("is nothing for a usage limit that names no reset", () => {
    expect(limitOf({ message: "You have reached your usage limit", now: NOW })).toBeNull()
  })
})
