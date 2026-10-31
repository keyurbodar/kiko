import { describe, expect, it } from "vitest"
import { applyInput, createInputState, modifiers } from "./input"

const VIEWPORT = { width: 1000, height: 500 }

function record() {
  const messages: Record<string, unknown>[] = []
  return { messages, send: (message: Record<string, unknown>) => messages.push(message) }
}

describe("browser input", () => {
  it("maps a click on the canvas to css pixels", () => {
    const { messages, send } = record()
    const state = createInputState()

    applyInput([{ k: "down", x: 0.25, y: 0.5, b: 0 }], VIEWPORT, state, send)
    applyInput([{ k: "up", x: 0.25, y: 0.5, b: 0 }], VIEWPORT, state, send)

    expect(messages).toEqual([
      { type: "input_mouse", eventType: "mousePressed", x: 250, y: 250, button: "left", clickCount: 1 },
      { type: "input_mouse", eventType: "mouseReleased", x: 250, y: 250, button: "left", clickCount: 1 },
    ])
  })

  it("carries the wheel deltas and the pointer position", () => {
    const { messages, send } = record()
    applyInput([{ k: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 120 }], VIEWPORT, createInputState(), send)
    expect(messages[0]).toEqual({
      type: "input_mouse",
      eventType: "mouseWheel",
      x: 500,
      y: 250,
      button: "none",
      deltaX: 0,
      deltaY: 120,
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

  it("turns a key into a stream keyboard message and types text as a char", () => {
    const { messages, send } = record()
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
    expect(messages[0]).toEqual({
      type: "input_keyboard",
      eventType: "keyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    })
    expect(messages[1]).toMatchObject({ type: "input_keyboard", eventType: "keyUp", key: "a", code: "KeyA" })
    expect(messages[2]).toEqual({ type: "input_keyboard", eventType: "char", text: "a" })
  })

  it("carries the character of a printable key so the page receives it", () => {
    const { messages, send } = record()
    applyInput(
      [
        { k: "key", code: "KeyH", key: "h", down: true, mods: 0 },
        { k: "key", code: "KeyH", key: "H", down: true, mods: 1 },
      ],
      VIEWPORT,
      createInputState(),
      send,
    )
    expect(messages[0]).toMatchObject({ eventType: "keyDown", key: "h", text: "h" })
    expect(messages[1]).toMatchObject({ eventType: "keyDown", key: "H", text: "H" })
  })

  it("gives enter and tab their text so they act", () => {
    const { messages, send } = record()
    applyInput(
      [
        { k: "key", code: "Enter", key: "Enter", down: true, mods: 0 },
        { k: "key", code: "Tab", key: "Tab", down: true, mods: 0 },
      ],
      VIEWPORT,
      createInputState(),
      send,
    )
    expect(messages[0]).toMatchObject({ key: "Enter", windowsVirtualKeyCode: 13, text: "\r" })
    expect(messages[1]).toMatchObject({ key: "Tab", windowsVirtualKeyCode: 9, text: "\t" })
  })
})
