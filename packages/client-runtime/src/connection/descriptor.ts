import { BackendDescriptor } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export type Descriptor =
  | ({ readonly _tag: "Current" } & BackendDescriptor)
  | { readonly _tag: "Legacy"; readonly version: string | null }
  | { readonly _tag: "Unreachable" }

const UNREACHABLE: Descriptor = { _tag: "Unreachable" }
const MISSING = new Set([404, 410])
const decode = Schema.decodeUnknownOption(BackendDescriptor)

const versionOf = (body: object): string | null =>
  "version" in body && typeof body.version === "string" ? body.version : null

function descriptorOf(status: number, body: unknown): Descriptor {
  if (MISSING.has(status)) return { _tag: "Legacy", version: null }
  if (typeof body !== "object" || body === null) return UNREACHABLE
  return Option.match(decode(body), {
    onSome: (descriptor) => ({ _tag: "Current", ...descriptor }),
    onNone: () => ({ _tag: "Legacy", version: versionOf(body) }),
  })
}

export const readDescriptor = (http: typeof globalThis.fetch, httpBaseUrl: string): Effect.Effect<Descriptor> =>
  Effect.tryPromise(async (signal) => {
    const response = await http(new URL("/api/version", httpBaseUrl), { cache: "no-store", signal })
    return descriptorOf(response.status, response.ok ? await response.json().catch(() => null) : null)
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.orElseSucceed(() => UNREACHABLE),
  )
