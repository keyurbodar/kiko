import { sha256Hex } from "@kiko/durable/hash"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import { failed, ROWS_FULL } from "./failure"
import { CodeCache, type OAuthTokens } from "./install"

const CODE_KEEP_MS = 10 * 60_000

type Kept = { tokens: OAuthTokens; at: number }

const stored = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => {
      const said = error instanceof Error ? error.message : String(error)
      return failed(ROWS_FULL.test(said) ? "storage_full" : "internal", said)
    },
  })

const keyOf = async (code: string) => `code:${await sha256Hex(code)}`

export const codeCache = (storage: Pick<DurableObjectStorage, "get" | "put" | "delete" | "list">) =>
  CodeCache.of({
    recall: (code) =>
      Effect.gen(function* () {
        const kept = yield* stored(async () => storage.get<Kept>(await keyOf(code)))
        const now = yield* Clock.currentTimeMillis
        return kept && now - kept.at < CODE_KEEP_MS ? kept.tokens : null
      }),
    remember: (code, tokens) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        yield* stored(async () => {
          const stale = [...(await storage.list<Kept>({ prefix: "code:" }))]
            .filter(([, kept]) => now - kept.at >= CODE_KEEP_MS)
            .map(([key]) => key)
          if (stale.length > 0) await storage.delete(stale)
          await storage.put(await keyOf(code), { tokens, at: now })
        })
      }),
    forget: (code) => stored(async () => void (await storage.delete(await keyOf(code)))),
  })
