import { OwnerRpcs } from "@kiko/protocol"
import type { OwnerRpcs as OwnerRpc } from "@kiko/protocol"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcSchema from "effect/rpc/RpcSchema"
import type * as Exit from "effect/Exit"

export const RPC_PONG = JSON.stringify({ _tag: "Pong" })

const RequestId = Schema.Union([Schema.String, Schema.Number])
export type RequestId = typeof RequestId.Type

const Incoming = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Request"),
    id: RequestId,
    tag: Schema.String,
    payload: Schema.Unknown,
  }),
  Schema.Struct({ _tag: Schema.Literal("Ack"), requestId: RequestId }),
  Schema.Struct({ _tag: Schema.Literal("Interrupt"), requestId: RequestId }),
  Schema.Struct({ _tag: Schema.Literal("Ping") }),
  Schema.Struct({ _tag: Schema.Literal("Eof") }),
])
export type Incoming = typeof Incoming.Type
export type IncomingRequest = Extract<Incoming, { _tag: "Request" }>

const decodeIncoming = Schema.decodeUnknownSync(Schema.Array(Incoming))

export function parseIncoming(raw: string): readonly Incoming[] | null {
  try {
    const value: unknown = JSON.parse(raw)
    return decodeIncoming(Array.isArray(value) ? value : [value])
  } catch {
    return null
  }
}

type AnyRpc = Rpc.AnyWithProps

const contractNeedsNoServices: [Rpc.Services<OwnerRpc>] extends [never] ? true : false = true

const serviceFree = (schema: Schema.Top): Schema.Codec<unknown, unknown> =>
  contractNeedsNoServices && (schema as Schema.Codec<unknown, unknown>)

export type Codecs = {
  readonly rpc: AnyRpc
  readonly stream: boolean
  readonly decodePayload: (payload: unknown) => unknown
  readonly encodeExit: (exit: Exit.Exit<unknown, unknown>) => unknown
  readonly encodeChunk: (values: readonly [unknown, ...unknown[]]) => unknown
}

const streamItem = (rpc: AnyRpc): Schema.Top =>
  RpcSchema.isStreamSchema(rpc.successSchema) ? rpc.successSchema.success : Schema.Unknown

const cache = new Map<string, Codecs>()

export function codecs(tag: string): Codecs | null {
  const hit = cache.get(tag)
  if (hit) return hit
  const rpc = (OwnerRpcs.requests as ReadonlyMap<string, AnyRpc>).get(tag)
  if (!rpc) return null
  const stream = RpcSchema.isStreamSchema(rpc.successSchema)
  const made: Codecs = {
    rpc,
    stream,
    decodePayload: Schema.decodeUnknownSync(serviceFree(Schema.toCodecJson(rpc.payloadSchema))),
    encodeExit: Schema.encodeUnknownSync(serviceFree(Schema.toCodecJson(Rpc.exitSchema(rpc)))),
    encodeChunk: Schema.encodeUnknownSync(serviceFree(Schema.toCodecJson(Schema.NonEmptyArray(streamItem(rpc))))),
  }
  cache.set(tag, made)
  return made
}

export const chunkFrame = (requestId: RequestId, values: unknown) =>
  JSON.stringify({ _tag: "Chunk", requestId, values })

export const exitFrame = (requestId: RequestId, exit: unknown) => JSON.stringify({ _tag: "Exit", requestId, exit })

export const dieFrame = (requestId: RequestId, defect: string) =>
  exitFrame(requestId, { _tag: "Failure", cause: [{ _tag: "Die", defect }] })
