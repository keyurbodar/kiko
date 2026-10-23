import { OwnerRpcs } from "@kiko/protocol/rpc"
import type * as Effect from "effect/Effect"
import * as RpcClient from "effect/rpc/RpcClient"
import type * as Rpc from "effect/rpc/Rpc"
import type * as Stream from "effect/Stream"

export const makeOwnerRpcClient = RpcClient.make(OwnerRpcs, { flatten: true, disableTracing: true })
export type OwnerRpcClient = Effect.Success<typeof makeOwnerRpcClient>

export type OwnerRpcTag = OwnerRpcs["_tag"]
type RpcOf<Tag extends OwnerRpcTag> = Rpc.ExtractTag<OwnerRpcs, Tag>
type StreamTags = { [Tag in OwnerRpcTag]: Rpc.Success<RpcOf<Tag>> extends Stream.Stream<any, any, any> ? Tag : never }

export type OwnerStreamTag = StreamTags[OwnerRpcTag]
export type OwnerUnaryTag = Exclude<OwnerRpcTag, OwnerStreamTag>
export type OwnerRpcInput<Tag extends OwnerRpcTag> = Rpc.PayloadConstructor<RpcOf<Tag>>
export type OwnerRpcSuccess<Tag extends OwnerRpcTag> = Rpc.SuccessExit<RpcOf<Tag>>
export type OwnerRpcFailure<Tag extends OwnerRpcTag> = Rpc.Error<RpcOf<Tag>>
export type OwnerRpcChunk<Tag extends OwnerStreamTag> = Rpc.SuccessChunk<RpcOf<Tag>>

export const PING_INTERVAL = "5 seconds"
export const PING_TIMEOUT = "15 seconds"
