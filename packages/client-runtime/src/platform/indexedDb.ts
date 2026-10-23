import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Semaphore from "effect/Semaphore"
import { SnapshotCacheError, SnapshotStore } from "./cache"

const DATABASE_NAME = "kiko:client-runtime"
const DATABASE_VERSION = 1
const STORE_NAME = "snapshots"

type Operation = SnapshotCacheError["operation"]

const failure = (operation: Operation, cause: unknown) =>
  new SnapshotCacheError({ operation, message: `IndexedDB ${operation} failed: ${String(cause)}` })

const isClosedConnection = (error: SnapshotCacheError) => error.message.includes("InvalidStateError")

const openDatabase = (factory: IDBFactory) =>
  Effect.callback<IDBDatabase, SnapshotCacheError>((resume) => {
    try {
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
      })
      request.addEventListener("error", () => resume(Effect.fail(failure("open", request.error))))
      request.addEventListener("success", () => resume(Effect.succeed(request.result)))
    } catch (cause) {
      resume(Effect.fail(failure("open", cause)))
    }
  })

function run<A>(
  database: IDBDatabase,
  operation: Operation,
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest,
  result: (request: IDBRequest) => A,
) {
  return Effect.callback<A, SnapshotCacheError>((resume) => {
    try {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = use(transaction.objectStore(STORE_NAME))
      transaction.addEventListener("abort", () => resume(Effect.fail(failure(operation, transaction.error))))
      transaction.addEventListener("complete", () => resume(Effect.succeed(result(request))))
    } catch (cause) {
      resume(Effect.fail(failure(operation, cause)))
    }
  })
}

const make = Effect.fn("IndexedDbSnapshotStore.make")(function* (options: {
  readonly namespace: string
  readonly factory?: IDBFactory
}) {
  const factory = options.factory ?? globalThis.indexedDB
  const lock = yield* Semaphore.make(1)
  let current: IDBDatabase | null = null
  const forget = (database: IDBDatabase) => {
    if (current === database) current = null
  }
  const get = Effect.suspend(() =>
    current !== null
      ? Effect.succeed(current)
      : factory === undefined
        ? Effect.fail(failure("open", "IndexedDB is unavailable in this browser context."))
        : lock.withPermits(1)(
            Effect.gen(function* () {
              if (current !== null) return current
              const opened = yield* openDatabase(factory)
              current = opened
              opened.addEventListener("close", () => forget(opened))
              opened.addEventListener("versionchange", () => {
                forget(opened)
                opened.close()
              })
              return opened
            }),
          ),
  )

  const withDatabase = <A>(use: (database: IDBDatabase) => Effect.Effect<A, SnapshotCacheError>) => {
    const attempt = get.pipe(
      Effect.flatMap((database) =>
        use(database).pipe(
          Effect.catchIf(isClosedConnection, (error) =>
            Effect.sync(() => forget(database)).pipe(Effect.andThen(Effect.fail({ closed: error } as const))),
          ),
        ),
      ),
    )
    return attempt.pipe(
      Effect.catchIf(
        (error): error is { readonly closed: SnapshotCacheError } => "closed" in error,
        () => Effect.flatMap(get, use),
      ),
    )
  }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      current?.close()
      current = null
    }),
  )

  const key = (name: string) => `${options.namespace}:${name}`
  return SnapshotStore.of({
    read: (name) =>
      withDatabase((database) =>
        run(
          database,
          "read",
          "readonly",
          (store) => store.get(key(name)),
          (request) => (typeof request.result === "string" ? Option.some(request.result) : Option.none<string>()),
        ),
      ),
    write: (name, value) =>
      withDatabase((database) =>
        run(
          database,
          "write",
          "readwrite",
          (store) => store.put(value, key(name)),
          () => undefined,
        ),
      ),
    remove: (name) =>
      withDatabase((database) =>
        run(
          database,
          "remove",
          "readwrite",
          (store) => store.delete(key(name)),
          () => undefined,
        ),
      ),
  })
})

export const layer = (options: { readonly namespace: string; readonly factory?: IDBFactory }) =>
  Layer.effect(SnapshotStore, make(options))
