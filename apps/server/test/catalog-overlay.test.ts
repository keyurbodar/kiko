import { expect, test } from "bun:test"
import { getBuiltinModelDataGeneratedAt } from "@earendil-works/pi-ai/providers/all"
import { applyOverlay, computeOverlay, findProvider, providers, setOverlay } from "../src/models/catalog"

const GENERATED = getBuiltinModelDataGeneratedAt()!
const NEWER = GENERATED + 86_400_000
const base = { ...findProvider("opencode-go")!.getModels()[0]! }
const bundled = () => base
const copy = (id: string, extra: object = {}) => ({ ...bundled(), id, name: id, ...extra })

test("a newer response keeps a new model and an older one keeps nothing", () => {
  const remote = { "opencode-go": [copy("brand-new")] }
  expect(computeOverlay(remote, NEWER, GENERATED)["opencode-go"]?.map((m) => m.id)).toEqual(["brand-new"])
  expect(computeOverlay(remote, GENERATED - 1, GENERATED)).toEqual({})
  expect(computeOverlay(remote, GENERATED, GENERATED)).toEqual({})
})

test("a provider kiko does not bundle is dropped", () => {
  expect(computeOverlay({ azure: [copy("x")] }, NEWER, GENERATED)).toEqual({})
})

test("a model on an api the provider never streams is dropped", () => {
  expect(computeOverlay({ "opencode-go": [copy("odd", { api: "openai-decisions" })] }, NEWER, GENERATED)).toEqual({})
})

test("a model identical to the bundled one is dropped, and a changed price is kept", () => {
  const same = { ...bundled() }
  const dearer = { ...bundled(), cost: { ...bundled().cost, input: bundled().cost.input + 1 } }
  expect(computeOverlay({ "opencode-go": [same] }, NEWER, GENERATED)).toEqual({})
  const out = computeOverlay({ "opencode-go": [dearer] }, NEWER, GENERATED)
  expect(out["opencode-go"]?.[0]?.id).toBe(bundled().id)
  expect(out["opencode-go"]?.[0]).toMatchObject({ cost: { input: bundled().cost.input + 1 } })
})

test("a reordered copy of a bundled model is still the same model", () => {
  const entries = Object.entries(bundled()).reverse()
  expect(computeOverlay({ "opencode-go": [Object.fromEntries(entries)] }, NEWER, GENERATED)).toEqual({})
})

test("malformed entries are dropped and the good ones around them stay", () => {
  const remote = {
    "opencode-go": [null, 7, "text", [], {}, { id: "no-name", api: "x" }, copy("bad-window", { contextWindow: "big" }), copy("bad-cost", { cost: { input: "free" } }), copy("bad-type", { type: "video" }), copy("fine")],
    anthropic: "not a list",
  }
  expect(computeOverlay(remote, NEWER, GENERATED)["opencode-go"]?.map((m) => m.id)).toEqual(["fine"])
  expect(computeOverlay(null, NEWER, GENERATED)).toEqual({})
  expect(computeOverlay([], NEWER, GENERATED)).toEqual({})
})

test("a model in the overlay is listed by the provider, replaces a bundled one of the same id, and leaves when the overlay does", () => {
  const priced = copy(bundled().id, { cost: { ...bundled().cost, input: 99 } })
  applyOverlay({ "opencode-go": [copy("only-in-overlay"), priced] as never })
  const listed = findProvider("opencode-go")!.getModels()
  expect(listed.some((m) => m.id === "only-in-overlay")).toBe(true)
  expect(listed.filter((m) => m.id === bundled().id)).toHaveLength(1)
  expect(listed.find((m) => m.id === bundled().id)?.cost.input).toBe(99)
  expect(providers().find((p) => p.id === "opencode-go")!.getAllModels!().some((m) => m.id === "only-in-overlay")).toBe(true)
  setOverlay("opencode-go", [])
  expect(findProvider("opencode-go")!.getModels().some((m) => m.id === "only-in-overlay")).toBe(false)
  expect(findProvider("opencode-go")!.getModels().find((m) => m.id === bundled().id)?.cost.input).not.toBe(99)
})
