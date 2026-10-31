import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as RpcClientError from "effect/rpc/RpcClientError"
import { OwnerSupervisor } from "../connection/supervisor"
import type {
  OwnerRpcChunk,
  OwnerRpcFailure,
  OwnerRpcInput,
  OwnerRpcSuccess,
  OwnerStreamTag,
  OwnerUnaryTag,
} from "./protocol"
import { isRpcClientError, type RpcSession } from "./session"

export class OwnerRpcUnavailableError extends Schema.TaggedError<OwnerRpcUnavailableError>()(
  "OwnerRpcUnavailableError",
  { message: Schema.String },
) {}

const MAX_EXPECTED_FAILURE_RETRY_DELAY_MS = 30_000

const RECOVERABLE_RPC_CLIENT_ERRORS: ReadonlySet<string> = new Set([
  "SocketReadError",
  "SocketWriteError",
  "SocketCloseError",
])

const isRecoverableRpcClientError = (error: RpcClientError.RpcClientError): boolean =>
  RECOVERABLE_RPC_CLIENT_ERRORS.has(error.reason._tag)

export const currentSession: Effect.Effect<RpcSession, OwnerRpcUnavailableError, OwnerSupervisor> = Effect.gen(
  function* () {
    const supervisor = yield* OwnerSupervisor
    const live = yield* SubscriptionRef.get(supervisor.session)
    if (Option.isNone(live)) return yield* new OwnerRpcUnavailableError({ message: "Kiko is not connected." })
    return live.value
  },
)

export type RequestError<Tag extends OwnerUnaryTag> =
  | OwnerRpcFailure<Tag>
  | RpcClientError.RpcClientError
  | OwnerRpcUnavailableError

export const request = <const Tag extends OwnerUnaryTag>(
  tag: Tag,
  input: OwnerRpcInput<Tag>,
): Effect.Effect<OwnerRpcSuccess<Tag>, RequestError<Tag>, OwnerSupervisor> =>
  currentSession.pipe(
    Effect.flatMap(
      (session) =>
        session.client(tag, input as never) as unknown as Effect.Effect<
          OwnerRpcSuccess<Tag>,
          OwnerRpcFailure<Tag> | RpcClientError.RpcClientError
        >,
    ),
  )

export interface SubscriptionOptions<E> {
  readonly onExpectedFailure?: (cause: Cause.Cause<E>) => Effect.Effect<void>
  readonly retryExpectedFailureAfter?: Duration.Input
  readonly resubscribe?: Stream.Stream<unknown>
}

type StreamFailure<Tag extends OwnerStreamTag> = OwnerRpcFailure<Tag>

export function subscribe<const Tag extends OwnerStreamTag>(
  tag: Tag,
  makeInput: (session: RpcSession) => Effect.Effect<OwnerRpcInput<Tag>>,
  options?: SubscriptionOptions<StreamFailure<Tag>>,
): Stream.Stream<OwnerRpcChunk<Tag>, StreamFailure<Tag>, OwnerSupervisor> {
  type Item = OwnerRpcChunk<Tag>
  type Failure = StreamFailure<Tag>
  return Stream.unwrap(
    Effect.gen(function* () {
      const supervisor = yield* OwnerSupervisor
      const changes = SubscriptionRef.changes(supervisor.session)
      const sessions =
        options?.resubscribe === undefined
          ? changes
          : Stream.merge(
              changes,
              options.resubscribe.pipe(Stream.mapEffect(() => SubscriptionRef.get(supervisor.session))),
            )
      return sessions.pipe(
        Stream.switchMap(
          Option.match({
            onNone: () => Stream.empty,
            onSome: (session) => {
              let retries = 0
              function reopen(): Stream.Stream<Item, Failure> {
                const after = options?.retryExpectedFailureAfter
                if (after === undefined) return Stream.empty
                const delay = Duration.millis(
                  Math.min(
                    Duration.toMillis(Duration.fromInputUnsafe(after)) * 2 ** retries,
                    MAX_EXPECTED_FAILURE_RETRY_DELAY_MS,
                  ),
                )
                retries += 1
                return Stream.fromEffect(Effect.sleep(delay)).pipe(Stream.drain, Stream.concat(open()))
              }
              function open(): Stream.Stream<Item, Failure> {
                return Stream.suspend(() =>
                  Stream.unwrap(
                    makeInput(session).pipe(
                      Effect.map((input) =>
                        (
                          session.client(tag, input as never) as unknown as Stream.Stream<
                            Item,
                            Failure | RpcClientError.RpcClientError
                          >
                        ).pipe(
                          Stream.onFirst(() =>
                            Effect.sync(() => {
                              retries = 0
                            }),
                          ),
                        ),
                      ),
                    ),
                  ).pipe(
                    Stream.catchCause((cause): Stream.Stream<Item, Failure> => {
                      const failures = cause.reasons.filter(Cause.isFailReason)
                      const expectedOnly = failures.length > 0 && failures.length === cause.reasons.length
                      const rpcFailures = failures.map((reason) => reason.error).filter(isRpcClientError)
                      if (expectedOnly && rpcFailures.length === failures.length) {
                        return rpcFailures.every(isRecoverableRpcClientError) ? reopen() : Stream.empty
                      }
                      if (!expectedOnly || options?.onExpectedFailure === undefined)
                        return Stream.failCause(cause as Cause.Cause<Failure>)
                      const handled = Stream.fromEffect(options.onExpectedFailure(cause as Cause.Cause<Failure>)).pipe(
                        Stream.drain,
                      )
                      return options.retryExpectedFailureAfter === undefined
                        ? handled
                        : handled.pipe(Stream.concat(reopen()))
                    }),
                  ),
                )
              }
              return open()
            },
          }),
        ),
      )
    }),
  )
}
