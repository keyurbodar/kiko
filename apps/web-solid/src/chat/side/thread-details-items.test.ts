import { describe, expect, it } from "vitest"
import {
  isDefaultThreadDetailsVisibility,
  readThreadDetailsChoice,
  RESET_THREAD_DETAILS,
  resolveThreadDetailsVisibility,
  setThreadDetailsItem,
  THREAD_DETAILS_ITEMS,
  type ThreadDetailsItemId,
} from "./thread-details-items"

const item = (id: ThreadDetailsItemId) => THREAD_DETAILS_ITEMS.find((entry) => entry.id === id)!

describe("thread details items", () => {
  it("shows every section by default", () => {
    const visibility = resolveThreadDetailsVisibility({})
    expect(Object.values(visibility).every(Boolean)).toBe(true)
    expect(isDefaultThreadDetailsVisibility(visibility)).toBe(true)
    expect(Object.keys(visibility)).toEqual(THREAD_DETAILS_ITEMS.map((entry) => entry.id))
  })

  it("stores only the sections that differ from the default", () => {
    const hidden = setThreadDetailsItem({}, item("helpers"), false)
    expect(hidden).toEqual({ helpers: false })
    expect(resolveThreadDetailsVisibility(hidden).helpers).toBe(false)
    expect(isDefaultThreadDetailsVisibility(resolveThreadDetailsVisibility(hidden))).toBe(false)
    const back = setThreadDetailsItem(hidden, item("helpers"), true)
    expect(back).toEqual({})
    expect(isDefaultThreadDetailsVisibility(resolveThreadDetailsVisibility(back))).toBe(true)
  })

  it("keeps one section's choice when another changes", () => {
    const choice = setThreadDetailsItem(setThreadDetailsItem({}, item("used"), false), item("outputs"), false)
    expect(choice).toEqual({ used: false, outputs: false })
  })

  it("resets to the defaults", () => {
    const visibility = resolveThreadDetailsVisibility(RESET_THREAD_DETAILS)
    expect(isDefaultThreadDetailsVisibility(visibility)).toBe(true)
  })

  it("ignores unknown values read from storage", () => {
    expect(readThreadDetailsChoice({ helpers: false, bogus: true, now: "yes" })).toEqual({ helpers: false })
    expect(readThreadDetailsChoice(null)).toEqual({})
    expect(readThreadDetailsChoice([false])).toEqual({})
  })
})
