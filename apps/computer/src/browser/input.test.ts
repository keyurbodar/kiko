import { describe, expect, it } from "vitest"
import { applyInput, createInputState, modifiers } from "./input"

const VIEWPORT = { width: 1000, height: 500 }

function record() {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  return { calls, send: (method: string, params: Record<string, unknown>) => calls.push({ method, params }) }
}

describe("browser input", () => {
  it("maps a click on the canvas to css pixels and holds the button until it lifts", () => {
    const { calls, send } = record()
    const state = createInputState()

    applyInput([{ k: "down", x: 0.25, y: 0.5, b: 0 }], VIEWPORT, state, send)
    applyInput([{ k: "up", x: 0.25, y: 0.5, b: 0 }], VIEWPORT, state, send)

    expect(calls).toEqual([
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mousePressed", x: 250, y: 250, button: "left", buttons: 1, clickCount: 1 },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseReleased", x: 250, y: 250, button: "left", buttons: 0, clickCount: 1 },
      },
    ])
  })

  it("carries the wheel deltas and the pointer position", () => {
    const { calls, send } = record()
    applyInput([{ k: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 120 }], VIEWPORT, createInputState(), send)
    expect(calls[0]).toEqual({
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseWheel", x: 500, y: 250, button: "none", buttons: 0, deltaX: 0, deltaY: 120 },
    })
  })

  it("maps the app's modifier bits onto the devtools order", () => {
    expect(modifiers(0)).toBe(0)
    expect(modifiers(1)).toBe(8)
    expect(modifiers(2)).toBe(2)
    expect(modifiers(4)).toBe(1)
    expect(modifiers(8)).toBe(4)
    expect(modifiers(15)).toBe(15)
  })

  it("turns a key into a devtools key event and types text with insertText", () => {
    const { calls, send } = record()
    applyInput(
      [
        { k: "key", code: "KeyA", key: "a", down: true, mods: 2 },
        { k: "key", code: "KeyA", key: "a", down: false, mods: 2 },
        { k: "text", s: "a" },
      ],
      VIEWPORT,
      createInputState(),
      send,
    )
    expect(calls[0]).toEqual({
      method: "Input.dispatchKeyEvent",
      params: {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
        modifiers: 2,
      },
    })
    expect(calls[1]?.params).toMatchObject({ type: "keyUp", key: "a", code: "KeyA" })
    expect(calls[2]).toEqual({ method: "Input.insertText", params: { text: "a" } })
  })

  it("gives enter and tab their text so they act", () => {
    const { calls, send } = record()
    applyInput(
      [
        { k: "key", code: "Enter", key: "Enter", down: true, mods: 0 },
        { k: "key", code: "Tab", key: "Tab", down: true, mods: 0 },
      ],
      VIEWPORT,
      createInputState(),
      send,
    )
    expect(calls[0]?.params).toMatchObject({ key: "Enter", windowsVirtualKeyCode: 13, text: "\r" })
    expect(calls[1]?.params).toMatchObject({ key: "Tab", windowsVirtualKeyCode: 9, text: "\t" })
  })
})
