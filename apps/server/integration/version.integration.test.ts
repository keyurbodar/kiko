import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { localWorker } from "./worker"

type Stats = { counters: Record<string, number>; instrumentation: Record<string, boolean> }

const getJson = (url: URL) => Effect.promise(() => fetch(url).then((response) => response.json() as Promise<unknown>))

describe("/api/version", () => {
  it.live("answers the frozen descriptor from the Worker without waking the owner's object", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const answers = yield* Effect.all(
        Array.from({ length: 3 }, () => getJson(new URL("api/version", worker.url))),
        { concurrency: "unbounded" },
      )
      for (const answer of answers) {
        assert.deepInclude(answer as object, { kiko: 1, protocol: 3, selfUpdate: false })
        assert.notProperty(answer, "rpc")
      }
      const stats = (yield* getJson(new URL("api/dev/stats", worker.url))) as Stats
      assert.deepStrictEqual(
        Object.keys(stats.counters).filter((key) => key.startsWith("rpc.") || key.startsWith("owner.")),
        [],
      )
      assert.notProperty(stats.instrumentation, "owner")
    }).pipe(Effect.scoped),
  )
})
