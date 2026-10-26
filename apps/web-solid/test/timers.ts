import { vi } from "vitest"

export function fakeTimers(): Disposable {
  vi.useFakeTimers()
  return { [Symbol.dispose]: () => vi.useRealTimers() }
}
