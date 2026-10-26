import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { BackendKey, BackendUrl, ClerkUserId, type Phase, SessionToken } from "./phase"

export const AuthRecord = Schema.Struct({
  v: Schema.Literal(1),
  identity: Schema.Struct({ clerkUserId: Schema.NullOr(ClerkUserId), email: Schema.String }),
  backend: Schema.Struct({ url: BackendUrl, key: BackendKey }),
  user: Schema.Struct({ id: Schema.String, name: Schema.String }),
  token: SessionToken,
})
export type AuthRecord = typeof AuthRecord.Type

export type Ready = Extract<Phase, { readonly _tag: "Ready" }>

const Json = Schema.fromJsonString(AuthRecord)
const decode = Schema.decodeUnknownOption(Json)
const encode = Schema.encodeSync(Json)

export const parseRecord = (raw: string | null): AuthRecord | null =>
  raw === null ? null : Option.getOrNull(decode(raw))

export const formatRecord = (record: AuthRecord): string => encode(record)

export const readyOf = (record: AuthRecord): Ready => ({
  _tag: "Ready",
  identity: record.identity,
  backend: record.backend,
  user: record.user,
  token: record.token,
  update: { _tag: "Current" },
})

export const recordOf = (ready: Ready): AuthRecord => ({
  v: 1,
  identity: ready.identity,
  backend: ready.backend,
  user: ready.user,
  token: ready.token,
})
