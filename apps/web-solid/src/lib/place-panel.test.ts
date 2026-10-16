import { describe, expect, test } from "bun:test"
import { placePanel } from "./place-panel"

const vp = { width: 1280, height: 800 }
const at = (top: number, left = 100, h = 28, w = 200) => ({ top, bottom: top + h, left, right: left + w })

describe("placePanel", () => {
  test("opens on the preferred side when it fits", () => {
    expect(placePanel(at(600), 420, 380, vp, "above")).toMatchObject({ bottom: "206px", "max-height": "380px" })
    expect(placePanel(at(100), 420, 380, vp, "below")).toMatchObject({ top: "134px", "max-height": "380px" })
  })

  test("flips to the other side when the preferred side is too short", () => {
    const high = placePanel(at(100), 420, 380, vp, "above")
    expect(high.top).toBe("134px")
    expect(high.bottom).toBeUndefined()
    const low = placePanel(at(700), 420, 380, vp, "below")
    expect(low.bottom).toBe("106px")
  })

  test("caps the height to the roomier side when neither fits", () => {
    const small = { width: 1280, height: 400 }
    const p = placePanel(at(100), 420, 380, small, "above")
    expect(p.top).toBe("134px")
    expect(p["max-height"]).toBe("258px")
  })

  test("keeps the panel 8 px inside the left and right edges", () => {
    expect(placePanel(at(600, 2), 420, 100, vp, "above").left).toBe("8px")
    expect(placePanel(at(600, 1200), 420, 100, vp, "above").left).toBe("852px")
    expect(placePanel(at(600, 1250), 420, 100, vp, "above", "end").right).toBe("8px")
    expect(placePanel(at(600, 1000), 420, 100, vp, "above", "end").right).toBe("80px")
  })
})
