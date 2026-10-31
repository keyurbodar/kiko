import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import { codeCache } from "./code-cache"

function memoryStorage() {
  const entries = new Map<string, unknown>()
  return {
    entries,
    storage: {
      get: async (key: string) => entries.get(key),
      put: async (key: string, value: unknown) => void entries.set(key, value),
      delete: async (keys: string | string[]) => {
        for (const key of [keys].flat()) entries.delete(key)
        return true
      },
      list: async ({ prefix = "" }: { prefix?: string } = {}) =>
        new Map([...entries].filter(([key]) => key.startsWith(prefix))),
    } as unknown as Parameters<typeof codeCache>[0],
  }
}

const TOKENS = { accessToken: "access", refreshToken: "refresh" }

describe("codeCache", () => {
  it.effect("hands back an exchanged OAuth code for ten minutes, then forgets it", () =>
    Effect.gen(function* () {
      const { storage, entries } = memoryStorage()
      const cache = codeCache(storage)
      yield* cache.remember("code-1", TOKENS)
      yield* TestClock.adjust("9 minutes")
      assert.deepStrictEqual(yield* cache.recall("code-1"), TOKENS)
      yield* TestClock.adjust("2 minutes")
      assert.isNull(yield* cache.recall("code-1"))
      yield* cache.remember("code-2", TOKENS)
      assert.strictEqual(entries.size, 1)
      yield* cache.forget("code-2")
      assert.isNull(yield* cache.recall("code-2"))
    }),
  )

  it.effect("deletes an expired entry when recall finds it", () =>
    Effect.gen(function* () {
      const { storage, entries } = memoryStorage()
      const cache = codeCache(storage)
      yield* cache.remember("code-1", TOKENS)
      yield* TestClock.adjust("11 minutes")
      assert.isNull(yield* cache.recall("code-1"))
      assert.strictEqual(entries.size, 0)
    }),
  )
})
