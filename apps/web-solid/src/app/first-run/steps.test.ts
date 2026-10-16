import { describe, expect, test } from "bun:test"
import { advance, positionOf, stepFor, type Facts } from "./steps"

const base: Facts = { signedIn: true, hosted: false, saved: null, fresh: false, known: false, connected: false }
const at = (over: Partial<Facts>) => stepFor({ ...base, ...over })

describe("stepFor", () => {
  test("signed out starts at welcome, except on a hosted build", () => {
    expect(at({ signedIn: false })).toBe("welcome")
    expect(at({ signedIn: false, hosted: true })).toBe("done")
  })

  test("a fresh sign-in goes straight to connect without waiting on the network", () => {
    expect(at({ fresh: true })).toBe("connect")
  })

  test("a signed-in owner with a key is never shown first run", () => {
    expect(at({ known: true, connected: true })).toBe("done")
    expect(at({ fresh: true, known: true, connected: true })).toBe("done")
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

test("positionOf counts steps from one", () => {
  expect(["welcome", "connect", "model", "done"].map((s) => positionOf(s as never))).toEqual([1, 2, 3, 0])
})
