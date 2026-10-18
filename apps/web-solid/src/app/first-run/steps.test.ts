import { describe, expect, test } from "bun:test"
import { advance, indexOf, modelToSave, shownModel, stepFor, stepFromSaved, stepsFor, type Facts } from "./steps"

const base: Facts = { signedIn: true, hosted: false, needsBackend: false, saved: null, fresh: false, known: false, connected: false, onboarded: false }
const at = (over: Partial<Facts>) => stepFor({ ...base, ...over })

test("a hosted build counts three steps and a self-hosted one two, with no welcome and no model screen", () => {
  expect(stepsFor(true).map((s) => s.step)).toEqual(["sign-in", "cloudflare", "connect"])
  expect(stepsFor(true).map((s) => s.label)).toEqual(["Sign in", "Cloudflare", "Provider"])
  expect(stepsFor(false).map((s) => s.step)).toEqual(["sign-in", "connect"])
  expect(stepsFor(false).map((s) => s.label)).toEqual(["Sign in", "Provider"])
})

describe("stepFor", () => {
  test("signed out opens on sign in, which carries the welcome copy, in a hosted build too", () => {
    expect(at({ signedIn: false })).toBe("sign-in")
    expect(at({ signedIn: false, hosted: true })).toBe("sign-in")
  })

  test("a step saved before sign-in does not skip the sign-in card", () => {
    expect(at({ signedIn: false, saved: "connect" })).toBe("sign-in")
    expect(at({ signedIn: false, hosted: true, saved: "done" })).toBe("sign-in")
  })

  test("a hosted person with no backend yet installs one", () => {
    expect(at({ signedIn: false, hosted: true, needsBackend: true })).toBe("cloudflare")
    expect(at({ signedIn: false, hosted: true, needsBackend: true, saved: "connect" })).toBe("cloudflare")
  })

  test("a self-hosted build never shows the Cloudflare step", () => {
    expect(at({ signedIn: false, needsBackend: true })).toBe("sign-in")
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
    expect(at({ saved: "done" })).toBe("done")
  })

  test("connect stays put once a provider is connected, so the model line and Start chatting show", () => {
    expect(at({ saved: "connect", connected: true })).toBe("connect")
    expect(at({ saved: "connect", connected: true, known: true })).toBe("connect")
  })

  test("a finished or skipped first run stays finished even with no key", () => {
    expect(at({ saved: "done", known: true })).toBe("done")
  })

  test("a skip the server remembers holds in a browser that saved nothing", () => {
    expect(at({ known: true, onboarded: true })).toBe("done")
    expect(at({ known: true, onboarded: false })).toBe("connect")
  })

  test("a skip the server remembers beats a step this browser saved before it", () => {
    expect(at({ saved: "connect", connected: true, known: true, onboarded: true })).toBe("done")
  })
})

test("a build that saved the model screen resumes on connect, where the model now lives", () => {
  expect(stepFromSaved("model")).toBe("connect")
  expect(stepFromSaved("connect")).toBe("connect")
  expect(stepFromSaved("done")).toBe("done")
  expect(stepFromSaved("welcome")).toBeNull()
  expect(stepFromSaved(null)).toBeNull()
})

describe("advance", () => {
  test("Start chatting and Skip for now both finish first run", () => {
    expect(advance("connect", "next")).toBe("done")
    expect(advance("connect", "skip")).toBe("done")
    expect(advance("done", "next")).toBe("done")
  })

  test("sign in and Cloudflare move on by their own calls, not by a button on the card", () => {
    expect(advance("sign-in", "next")).toBe("sign-in")
    expect(advance("cloudflare", "next")).toBe("cloudflare")
  })
})

test("indexOf places each step in the stepper, with Cloudflare only when hosted", () => {
  const steps = ["sign-in", "cloudflare", "connect", "done"] as const
  expect(steps.map((s) => indexOf(s, false))).toEqual([0, -1, 1, 2])
  expect(steps.map((s) => indexOf(s, true))).toEqual([0, 1, 2, 3])
})

describe("the model line saves only the model the human sees picked", () => {
  test("Start chatting on the running model saves nothing", () => {
    expect(modelToSave("opencode-go/muse-spark-1.3-contributor", "opencode-go/muse-spark-1.3-contributor")).toBeNull()
    expect(modelToSave(undefined, undefined)).toBeNull()
  })
  test("Start chatting saves the shown row when Kiko runs on another model", () => {
    expect(modelToSave("opencode-go/b", "opencode-go/a")).toBe("opencode-go/b")
    expect(modelToSave("anthropic/a", "opencode-go/muse-spark-1.3-contributor")).toBe("anthropic/a")
  })
  test("the shown row is the running model when listed, else the provider's first: Kiko never invents one", () => {
    expect(shownModel(null, "p/b", ["p/a", "p/b"])).toBe("p/b")
    expect(shownModel(null, "p/x", ["p/a", "p/b"])).toBeUndefined()
    expect(shownModel(null, undefined, ["p/a", "p/b"])).toBeUndefined()
    expect(shownModel("p/b", "p/a", ["p/a", "p/b"])).toBe("p/b")
  })
})
