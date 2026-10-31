import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { describe, expect, it, vi } from "vitest"
import { createPromptInputV2Controller } from "./interaction"
import type { PromptInputV2PersistedState } from "./types"

const platform = vi.hoisted(() => ({ mac: false }))
vi.mock("../../lib/platform", () => ({
  get isMac() {
    return platform.mac
  },
}))

const makeController = () => {
  let clicks = 0
  const controller = createRoot((dispose) => {
    const [store, setStore] = createStore<PromptInputV2PersistedState>({ prompt: [] })
    const built = createPromptInputV2Controller({
      store: [store, setStore],
      tokens: () => [],
      agents: () => [],
      view: { submit: { onSubmit: () => {} } },
    })
    built.setFileInput({ click: () => clicks++ } as unknown as HTMLInputElement)
    dispose()
    return built
  })
  return {
    controller,
    clicks: () => clicks,
    press(modifiers: { meta?: boolean; ctrl?: boolean }) {
      const prevented: string[] = []
      const handled = controller.onKeyDown({
        key: "u",
        metaKey: modifiers.meta ?? false,
        ctrlKey: modifiers.ctrl ?? false,
        altKey: false,
        shiftKey: false,
        preventDefault: () => prevented.push("yes"),
      } as unknown as KeyboardEvent)
      return { handled, prevented: prevented.length, clicks: clicks }
    },
  }
}

describe("prompt input attach key", () => {
  it("attaches on Ctrl+U and not Cmd+U away from macOS", () => {
    platform.mac = false
    const { press } = makeController()
    expect(press({ ctrl: true })).toEqual({ handled: true, prevented: 1, clicks: 1 })
    expect(press({ meta: true })).toEqual({ handled: false, prevented: 0, clicks: 1 })
  })

  it("attaches on Cmd+U on macOS and leaves Ctrl+U to delete to the line start", () => {
    platform.mac = true
    const { press } = makeController()
    expect(press({ meta: true })).toEqual({ handled: true, prevented: 1, clicks: 1 })
    expect(press({ ctrl: true })).toEqual({ handled: false, prevented: 0, clicks: 1 })
  })
})
