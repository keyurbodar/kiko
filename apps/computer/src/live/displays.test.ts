import { describe, expect, it } from "vitest"
import {
  focusedDisplay,
  listDisplays,
  orderDisplays,
  parseMonitors,
  parseOutputs,
  parseScreens,
  parseWindows,
  type Command,
} from "./displays"

const MONITORS = `Monitors: 2
 0: +*eDP-1 1920/344x1080/194+0+0  eDP-1
 1: +HDMI-1 1280/340x1024/271+1920+0  HDMI-1
`

const QUERY = `eDP-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 344mm x 194mm
HDMI-1 connected 1280x1024+1920+0 (normal left inverted right x axis y axis) 340mm x 271mm
`

const SCREENS = JSON.stringify([
  { id: "69733248", index: 0, width: 1512, height: 982, scale: 2, x: 0, y: 0 },
  { id: "72428190", index: 1, width: 1920, height: 1080, scale: 1, x: 1512, y: 0 },
])

const answer = (code: number, out: string): Command => ({ code, out })

describe("the display list", () => {
  it("reads the monitors xrandr lists, with their origins", () => {
    expect(parseMonitors(MONITORS)).toEqual([
      { id: "eDP-1", width: 1920, height: 1080, scale: 1, originX: 0, originY: 0, index: 0 },
      { id: "HDMI-1", width: 1280, height: 1024, scale: 1, originX: 1920, originY: 0, index: 1 },
    ])
  })

  it("reads connected outputs when the monitors call says nothing", () => {
    expect(parseMonitors("Monitors: 0\n")).toEqual([])
    expect(parseOutputs(QUERY)).toEqual([
      { id: "eDP-1", width: 1920, height: 1080, scale: 1, originX: 0, originY: 0, index: 0 },
      { id: "HDMI-1", width: 1280, height: 1024, scale: 1, originX: 1920, originY: 0, index: 1 },
    ])
  })

  it("reads the screens macOS reports, Retina scale included", () => {
    expect(parseScreens(SCREENS)).toEqual([
      { id: "69733248", width: 1512, height: 982, scale: 2, originX: 0, originY: 0, index: 0 },
      { id: "72428190", width: 1920, height: 1080, scale: 1, originX: 1512, originY: 0, index: 1 },
    ])
    expect(parseScreens("not json")).toEqual([])
  })

  it("asks xrandr on Linux and falls back to its query", async () => {
    const asked: string[][] = []
    const found = await listDisplays({
      platform: "linux",
      run: (cmd) => {
        asked.push(cmd)
        return Promise.resolve(cmd.includes("--listmonitors") ? answer(0, "Monitors: 0\n") : answer(0, QUERY))
      },
    })
    expect(asked).toEqual([
      ["xrandr", "--listmonitors"],
      ["xrandr", "--query"],
    ])
    expect(found.map((display) => display.id)).toEqual(["eDP-1", "HDMI-1"])
  })

  it("asks the window server on macOS", async () => {
    const found = await listDisplays({ platform: "macos", run: () => Promise.resolve(answer(0, SCREENS)) })
    expect(found[0]?.scale).toBe(2)
    expect(found[1]?.originX).toBe(1512)
  })

  it("says nothing when the system answers with nothing", async () => {
    expect(await listDisplays({ platform: "linux", run: () => Promise.resolve(answer(1, "")) })).toEqual([])
    expect(await listDisplays({ platform: "macos", run: () => Promise.resolve(answer(1, "")) })).toEqual([])
  })
})

describe("the default display", () => {
  const displays = parseMonitors(MONITORS)

  it("is the display holding the focused window", () => {
    const windows = parseWindows({
      windows: [
        { bounds: { x: 2000, y: 100, width: 600, height: 400 }, z_index: 5, is_on_screen: true, layer: 0 },
        { bounds: { x: 100, y: 100, width: 800, height: 400 }, z_index: 9, is_on_screen: true, layer: 0 },
      ],
    })
    expect(focusedDisplay(displays, windows)).toBe(0)
    expect(orderDisplays(displays, windows).map((display) => display.id)).toEqual(["eDP-1", "HDMI-1"])
  })

  it("moves the focused display to the front", () => {
    const windows = [{ x: 2400, y: 200, width: 400, height: 300, z: 3 }]
    expect(orderDisplays(displays, windows).map((display) => display.id)).toEqual(["HDMI-1", "eDP-1"])
  })

  it("is the primary display when no window says otherwise", () => {
    expect(focusedDisplay(displays, [])).toBe(0)
    const shifted = [
      { ...displays[0]!, originX: 500, originY: 0 },
      { ...displays[1]!, originX: 0, originY: 0 },
    ]
    expect(focusedDisplay(shifted, [{ x: 5000, y: 5000, width: 10, height: 10, z: 1 }])).toBe(1)
  })

  it("ignores offscreen, layered and unranked windows", () => {
    const windows = parseWindows({
      windows: [
        { bounds: { x: 2400, y: 200, width: 400, height: 300 }, z_index: 9, is_on_screen: false },
        { bounds: { x: 2400, y: 200, width: 400, height: 300 }, z_index: 9, layer: 4 },
        { bounds: { x: 2400, y: 200, width: 400, height: 300 } },
        { bounds: { x: 100, y: 100, width: 400, height: 300 }, z_index: 1 },
      ],
    })
    expect(windows).toHaveLength(1)
    expect(focusedDisplay(displays, windows)).toBe(0)
  })
})
