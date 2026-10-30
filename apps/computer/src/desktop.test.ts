import { describe, expect, it } from "@effect/vitest"
import type { Access, Area, Backend } from "./desk/backend"
import { Deadline } from "./deadline"
import { Desktop, fitInside, type Codec } from "./desktop"
import type { Native } from "./live/native/contract"
import { Fail } from "./log"

const AREA: Area = { width: 1440, height: 900, originX: 0, originY: 0 }
const SHOT = { width: 2880, height: 1800 }

type Call = { name: string; args: unknown[] }

type Options = { area?: Area | null; access?: Access; cursor?: { x: number; y: number } | null }

function fake(options: Options = {}) {
  const calls: Call[] = []
  const native: Native = {
    move: (x, y) => calls.push({ name: "move", args: [x, y] }),
    button: (slot, down, x, y) => calls.push({ name: "button", args: [slot, down, x, y] }),
    wheel: (pixels, horizontal) => calls.push({ name: "wheel", args: [pixels, horizontal] }),
    key: (code, key, down) => calls.push({ name: "key", args: [code, key, down] }),
    text: (value) => calls.push({ name: "text", args: [value] }),
    cursor: () => options.cursor ?? null,
    screen: () => SHOT,
    release: () => calls.push({ name: "release", args: [] }),
  }
  const backend: Backend = {
    native,
    area: () => (options.area === undefined ? AREA : options.area),
    shoot: async (area) => {
      calls.push({ name: "shoot", args: [area] })
      return { bytes: new Uint8Array([1, 2, 3]) }
    },
    access: () => options.access ?? { screen: true, input: true },
    requestAccess: () => {},
    open: async (target) => {
      calls.push({ name: "open", args: [target] })
    },
    close: () => {},
  }
  const codec: Codec = async (_bytes, limit) => ({ data: "jpeg", ...fitInside(SHOT.width, SHOT.height, limit) })
  return { calls, backend, desktop: new Desktop(backend, codec) }
}

function deadline(): Deadline {
  return new Deadline(60_000)
}

function named(calls: readonly Call[], name: string): Call[] {
  return calls.filter((call) => call.name === name)
}

async function rejection(run: () => Promise<unknown>): Promise<Fail> {
  try {
    await run()
  } catch (error) {
    if (error instanceof Fail) return error
    throw error
  }
  throw new Error("the call did not fail")
}

describe("fitInside", () => {
  it("scales the long edge down and never enlarges", () => {
    expect(fitInside(2880, 1800, 1280)).toEqual({ width: 1280, height: 800 })
    expect(fitInside(800, 600, 1280)).toEqual({ width: 800, height: 600 })
    expect(fitInside(900, 1600, 1280)).toEqual({ width: 720, height: 1280 })
  })
})

describe("Desktop.look", () => {
  it("shrinks a Retina shot to the long edge and reports the image size", async () => {
    const { desktop } = fake()

    const view = await desktop.look({}, deadline())

    expect(view.width).toBe(1280)
    expect(view.height).toBe(800)
    expect(view.captureId).toHaveLength(12)
    expect(view.controls).toEqual([])
    expect(view.image).toEqual({ mime: "image/jpeg", data: "jpeg" })
  })

  it("leaves the image out when asked", async () => {
    const { desktop } = fake()

    const view = await desktop.look({ image: false }, deadline())

    expect(view.image).toBeUndefined()
    expect(view.width).toBe(1280)
  })

  it("fails with the screen recording permission when the system has not granted it", async () => {
    const { desktop } = fake({ access: { screen: false, input: true } })

    const error = await rejection(() => desktop.look({}, deadline()))

    expect(error.code).toBe("denied")
    expect(error.message).toMatch(/record the screen/)
  })

  it("keeps a granted screen access through a later false reading", async () => {
    let access: Access = { screen: true, input: true }
    const { desktop, backend } = fake()
    backend.access = () => access

    await desktop.look({}, deadline())
    access = { screen: false, input: true }

    await expect(desktop.look({}, deadline())).resolves.toMatchObject({ width: 1280 })
  })
})

describe("Desktop.act", () => {
  it("maps screenshot pixels back through the Retina area", async () => {
    const { desktop, calls } = fake()
    const view = await desktop.look({}, deadline())

    await desktop.act({ captureId: view.captureId, steps: [{ op: "click", x: 640, y: 400 }] }, deadline())

    expect(named(calls, "move")).toEqual([{ name: "move", args: [720, 450] }])
    expect(named(calls, "button")).toEqual([
      { name: "button", args: [0, true, 720, 450] },
      { name: "button", args: [0, false, 720, 450] },
    ])
  })

  it("clicks the current cursor when x and y are left out", async () => {
    const { desktop, calls } = fake({ cursor: { x: 720, y: 450 } })
    const view = await desktop.look({}, deadline())

    await desktop.act({ captureId: view.captureId, steps: [{ op: "click", button: "right", count: 2 }] }, deadline())

    expect(named(calls, "button")).toEqual([
      { name: "button", args: [1, true, 720, 450] },
      { name: "button", args: [1, false, 720, 450] },
      { name: "button", args: [1, true, 720, 450] },
      { name: "button", args: [1, false, 720, 450] },
    ])
  })

  it("types into the focus, and clicks a field first when given a position", async () => {
    const focused = fake()
    const focusedView = await focused.desktop.look({}, deadline())
    await focused.desktop.act({ captureId: focusedView.captureId, steps: [{ op: "type", text: "hello" }] }, deadline())

    expect(named(focused.calls, "text")).toEqual([{ name: "text", args: ["hello"] }])
    expect(named(focused.calls, "move")).toEqual([])

    const placed = fake()
    const placedView = await placed.desktop.look({}, deadline())
    await placed.desktop.act(
      { captureId: placedView.captureId, steps: [{ op: "type", x: 640, y: 400, text: "hello", submit: true }] },
      deadline(),
    )

    expect(named(placed.calls, "move")[0]).toEqual({ name: "move", args: [720, 450] })
    expect(named(placed.calls, "text")).toEqual([{ name: "text", args: ["hello"] }])
    expect(named(placed.calls, "key")).toContainEqual({ name: "key", args: ["Enter", "Enter", true] })
  })

  it("presses a chord with its modifiers around the key", async () => {
    const { desktop, calls } = fake()
    const view = await desktop.look({}, deadline())

    await desktop.act({ captureId: view.captureId, steps: [{ op: "key", keys: "cmd+shift+l" }] }, deadline())

    expect(named(calls, "key")).toEqual([
      { name: "key", args: ["MetaLeft", "MetaLeft", true] },
      { name: "key", args: ["ShiftLeft", "ShiftLeft", true] },
      { name: "key", args: ["KeyL", "l", true] },
      { name: "key", args: ["KeyL", "l", false] },
      { name: "key", args: ["ShiftLeft", "ShiftLeft", false] },
      { name: "key", args: ["MetaLeft", "MetaLeft", false] },
    ])
  })

  it("scrolls by screen points with positive going down", async () => {
    const { desktop, calls } = fake()
    const view = await desktop.look({}, deadline())

    await desktop.act({ captureId: view.captureId, steps: [{ op: "scroll", dy: 500, dx: -300 }] }, deadline())

    expect(named(calls, "wheel")).toEqual([
      { name: "wheel", args: [563, false] },
      { name: "wheel", args: [-338, true] },
    ])
  })

  it("opens an app or URL through the backend", async () => {
    const { desktop, calls } = fake()
    const view = await desktop.look({}, deadline())

    await desktop.act({ captureId: view.captureId, steps: [{ op: "open", app: "https://example.com" }] }, deadline())

    expect(named(calls, "open")).toEqual([{ name: "open", args: ["https://example.com"] }])
  })

  it("looks first when there is no screenshot yet", async () => {
    const { desktop, calls } = fake()

    await desktop.act({ steps: [{ op: "move", x: 10, y: 20 }] }, deadline())

    expect(named(calls, "move")[0]).toEqual({ name: "move", args: [11, 23] })
  })

  it("answers stale for a screenshot it no longer holds", async () => {
    const { desktop } = fake()

    const error = await rejection(() => desktop.act({ captureId: "gone", steps: [] }, deadline()))

    expect(error.code).toBe("stale")
  })

  it("stops at a failing step and still returns a fresh view", async () => {
    const { desktop, calls } = fake()
    const view = await desktop.look({}, deadline())

    const result = await desktop.act(
      {
        captureId: view.captureId,
        steps: [
          { op: "key", keys: "enter" },
          { op: "click", id: 3 },
          { op: "key", keys: "tab" },
        ],
      },
      deadline(),
    )

    expect(result.done).toBe(1)
    expect(result.error).toBe("element ids are not supported; click by x,y")
    expect(result.view.captureId).not.toBe(view.captureId)
    expect(named(calls, "key").map((call) => call.args[0])).toEqual(["Enter", "Enter"])
  })

  it("fails with the input permission when the system has not granted it", async () => {
    const { desktop } = fake({ access: { screen: true, input: false } })
    const view = await desktop.look({}, deadline())

    const error = await rejection(() => desktop.act({ captureId: view.captureId, steps: [] }, deadline()))

    expect(error.code).toBe("denied")
    expect(error.message).toMatch(/control/)
  })

  it("reports unsupported when the machine has no display", async () => {
    const { desktop } = fake({ area: null })

    const error = await rejection(() => desktop.look({}, deadline()))

    expect(error.code).toBe("unsupported")
  })

  it("zooms into a box of the last screenshot without moving its coordinates", async () => {
    const { desktop, calls } = fake()
    const view = await desktop.look({}, deadline())

    const zoomed = await desktop.look({ zoom: { x: 640, y: 0, width: 320, height: 100 } }, deadline())

    expect(named(calls, "shoot").at(-1)).toEqual({
      name: "shoot",
      args: [{ originX: 720, originY: 0, width: 360, height: 113 }],
    })
    expect(zoomed).toMatchObject({ captureId: view.captureId, width: view.width, height: view.height })
    expect(zoomed.image?.mime).toBe("image/jpeg")
  })

  it("refuses a zoom box outside the screenshot", async () => {
    const { desktop } = fake()
    await desktop.look({}, deadline())

    const failure = await rejection(() => desktop.look({ zoom: { x: 5000, y: 0, width: 10, height: 10 } }, deadline()))

    expect(failure.message).toContain("outside the screenshot")
  })
})
