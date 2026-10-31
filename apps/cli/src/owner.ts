import { OWNER_RPC_PATH, OwnerRpcs } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"
import { CliError, type Context } from "./context"
import { sessionToken } from "./commands/login"

const SOCKET_PROTOCOL = "kiko"

const makeClient = RpcClient.make(OwnerRpcs)
export type OwnerClient = Effect.Success<typeof makeClient>

const protocol = (url: string, token: string) => {
  const target = new URL(OWNER_RPC_PATH, url)
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(target.href, { protocols: [SOCKET_PROTOCOL, token] })),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  )
}

const failure = (error: unknown) =>
  new CliError({
    message:
      typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : String(error),
  })

export async function withOwner<A, E>(ctx: Context, run: (client: OwnerClient) => Effect.Effect<A, E>): Promise<A> {
  const token = await sessionToken(ctx.url)
  if (!token) throw new CliError({ message: "not signed in. run `kiko login --dev` first" })
  return Effect.runPromise(
    makeClient.pipe(
      Effect.timeoutOrElse({
        duration: 5000,
        orElse: () => Effect.fail(new CliError({ message: `no answer from ${new URL(ctx.url).origin} within 5s` })),
      }),
      Effect.flatMap(run),
      Effect.mapError(failure),
      Effect.scoped,
      Effect.provide(protocol(ctx.url, token)),
    ),
  )
}
