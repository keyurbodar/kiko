import { assert, describe, it } from "@effect/vitest"
import { cachedPolicy } from "./policy"
import type { LivePolicy } from "./types"

function loader() {
  let calls = 0
  let next: LivePolicy = { live: true, input: true }
  let fail = false
  const load = async (): Promise<LivePolicy> => {
    calls++
    if (fail) throw new Error("unreadable")
    return next
  }
  return {
    load,
    calls: () => calls,
    set(value: LivePolicy) {
      next = value
    },
    breaks() {
      fail = true
    },
  }
}

describe("live policy cache", () => {
  it("reloads at most once a second", async () => {
    let now = 0
    const source = loader()
    const policy = cachedPolicy({ live: true, input: true }, source.load, () => now)

    assert.deepStrictEqual(policy(), { live: true, input: true })
    assert.strictEqual(source.calls(), 0)

    source.set({ live: false, input: false })
    now = 1_000
    assert.deepStrictEqual(policy(), { live: true, input: true })
    assert.strictEqual(source.calls(), 1)

    await Promise.resolve()
    assert.deepStrictEqual(policy(), { live: false, input: false })

    now = 1_500
    policy()
    assert.strictEqual(source.calls(), 1)

    now = 2_000
    policy()
    assert.strictEqual(source.calls(), 2)
  })

  it("keeps the last policy when the file cannot be read", async () => {
    let now = 0
    const source = loader()
    const policy = cachedPolicy({ live: true, input: true }, source.load, () => now)
    source.set({ live: false, input: false })
    now = 1_000
    policy()
    await Promise.resolve()
    assert.deepStrictEqual(policy(), { live: false, input: false })

    source.breaks()
    now = 2_000
    policy()
    await Promise.resolve()
    assert.deepStrictEqual(policy(), { live: false, input: false })
  })
})
