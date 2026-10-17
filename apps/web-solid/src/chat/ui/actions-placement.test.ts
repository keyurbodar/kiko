import { describe, expect, test } from "bun:test"
import { ACTIONS_WIDTH, actionsPlacement } from "./actions-placement"

const scroller = { left: 0, right: 600 }

describe("actionsPlacement", () => {
  test("a bot bubble with room on its right keeps the actions beside it", () => {
    expect(actionsPlacement("bot", { left: 16, right: 600 - ACTIONS_WIDTH }, scroller)).toBe("outside")
  })
  test("a wide bot bubble moves them onto its top edge", () => {
    expect(actionsPlacement("bot", { left: 16, right: 600 - ACTIONS_WIDTH + 1 }, scroller)).toBe("inside")
  })
  test("a user bubble measures the room on its left", () => {
    expect(actionsPlacement("user", { left: ACTIONS_WIDTH, right: 584 }, scroller)).toBe("outside")
    expect(actionsPlacement("user", { left: ACTIONS_WIDTH - 1, right: 584 }, scroller)).toBe("inside")
  })
  test("a scroller that does not start at zero is measured from its own edge", () => {
    expect(actionsPlacement("user", { left: 300 + ACTIONS_WIDTH, right: 800 }, { left: 300, right: 900 })).toBe("outside")
  })
  test("the run chevron takes room from the actions, which move onto the bubble when it does not leave enough", () => {
    const bubble = { left: 16, right: 600 - ACTIONS_WIDTH }
    expect(actionsPlacement("bot", bubble, scroller, 36)).toBe("inside")
    expect(actionsPlacement("bot", { left: 16, right: 600 - ACTIONS_WIDTH - 36 }, scroller, 36)).toBe("outside")
  })
})
