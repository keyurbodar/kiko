import * as Atom from "effect/reactivity/Atom"
import { createComputed, createRoot } from "solid-js"
import { describe, expect, it } from "vitest"
import { registry, watch } from "./runtime"

describe("watch", () => {
  it("keeps delivering updates after a view throws on one of them", () => {
    const count = Atom.make(0)
    const reported: unknown[] = []
    const onError = (event: ErrorEvent) => {
      reported.push(event.error)
      event.preventDefault()
    }
    addEventListener("error", onError)
    const [value, dispose] = createRoot((dispose) => {
      const broken = watch(() => count)
      createComputed(() => {
        if (broken() === 1) throw new Error("view broke")
      })
      return [watch(() => count), dispose] as const
    })
    try {
      expect(() => registry.set(count, 1)).not.toThrow()
      registry.set(count, 2)
      expect(value()).toBe(2)
      expect(reported).toEqual([new Error("view broke")])
    } finally {
      dispose()
      removeEventListener("error", onError)
    }
  })
})
