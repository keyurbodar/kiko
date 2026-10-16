import { describe, expect, test } from "bun:test"
import { advance, indexOf, stepFor, type Facts } from "./steps"

const base: Facts = { signedIn: true, hosted: false, started: false, needsBackend: false, saved: null, fresh: false, known: false, connected: false }
const at = (over: Partial<Facts>) => stepFor({ ...base, ...over })

describe("stepFor", () => {
  test("signed out starts at welcome, in a hosted build too", () => {
    expect(at({ signedIn: false })).toBe("welcome")
    expect(at({ signedIn: false, hosted: true })).toBe("welcome")
  })

  test("get started, or a browser that signed in before, goes to sign in", () => {
    expect(at({ signedIn: false, started: true })).toBe("sign-in")
    expect(at({ signedIn: false, started: true, hosted: true })).toBe("sign-in")
  })

  test("a hosted person with no backend yet installs one", () => {
    expect(at({ signedIn: false, hosted: true, needsBackend: true })).toBe("cloudflare")
    expect(at({ signedIn: false, hosted: true, needsBackend: true, started: true })).toBe("cloudflare")
  })

  test("a self-hosted build never shows the Cloudflare step", () => {
    expect(at({ signedIn: false, needsBackend: true, started: true })).toBe("sign-in")
  })

  test("a fresh sign-in goes straight to connect without waiting on the network", () => {
    expect(at({ fresh: true })).toBe("connect")
  })

  test("a signed-in owner with a key is never shown first run", () => {
    expect(at({ known: true, connected: true })).toBe("done")
    expect(at({ fresh: true, known: true, connected: true })).toBe("done")
    expect(at({ known: true, connected: true, hosted: true, needsBackend: true })).toBe("done")
  })

  test("a signed-in owner with no key and no saved step is sent to connect", () => {
    expect(at({ known: true })).toBe("connect")
  })

  test("before the server answers, a returning owner sees the app, not first run", () => {
    expect(at({})).toBe("done")
  })

  test("a saved step resumes after a reload", () => {
    expect(at({ saved: "connect" })).toBe("connect")
    expect(at({ saved: "model", connected: true })).toBe("model")
  })

  test("connect moves on to model as soon as a provider is connected", () => {
    expect(at({ saved: "connect", connected: true })).toBe("model")
  })

  test("a finished or skipped first run stays finished even with no key", () => {
    expect(at({ saved: "done", known: true })).toBe("done")
  })
})

describe("advance", () => {
  test("each button moves one step", () => {
    expect(advance("connect", "next")).toBe("model")
    expect(advance("connect", "skip")).toBe("done")
    expect(advance("model", "next")).toBe("done")
    expect(advance("done", "next")).toBe("done")
  })
})

test("indexOf places each step in the stepper, with Cloudflare only when hosted", () => {
  const steps = ["welcome", "sign-in", "cloudflare", "connect", "model", "done"] as const
  expect(steps.map((s) => indexOf(s, false))).toEqual([-1, 0, -1, 1, 2, 3])
  expect(steps.map((s) => indexOf(s, true))).toEqual([-1, 0, 1, 2, 3, 4])
})
