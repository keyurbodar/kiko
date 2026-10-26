import { describe, expect, it, vi } from "vitest"
import { enterIsNewline } from "./ime"

function touchScreen() {
  const spy = vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query === "(pointer: coarse)",
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  )
  return { [Symbol.dispose]: () => spy.mockRestore() }
}

describe("Enter on a touch screen", () => {
  it("keeps making a new line after the on-screen Return key has been pressed", () => {
    using _touch = touchScreen()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
    expect(enterIsNewline({ metaKey: false, ctrlKey: false })).toBe(true)
  })

  it("still sends with Cmd or Ctrl and Enter", () => {
    using _touch = touchScreen()
    expect(enterIsNewline({ metaKey: true, ctrlKey: false })).toBe(false)
    expect(enterIsNewline({ metaKey: false, ctrlKey: true })).toBe(false)
  })
})
