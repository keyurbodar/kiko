import { RegistryContext } from "@effect/atom-solid"
import { layerBrowser } from "@kiko/client-runtime/state"
import {
  createOwnerAtoms,
  executeAtomQuery,
  runAtomCommand,
  type AtomCommand,
  type SettledAsyncResult,
} from "@kiko/client-runtime/state"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { createComponent, createComputed, createMemo, createSignal, onCleanup, type Accessor, type JSX } from "solid-js"
import { RUNTIME_DATABASE } from "../lib/storage"

export interface Attachment {
  readonly url: string
  readonly key: string
  readonly token: string
}

let attached: Attachment | null = null
let closed: Promise<void> = Promise.resolve()
let replaced: Promise<void> = Promise.resolve()

const cacheKeyAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive, Atom.withLabel("kiko-cache-key"))

const lifetime = () =>
  Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.sync(() => {
        let done = () => {}
        closed = new Promise<void>((resolve) => {
          done = resolve
        })
        return done
      }),
      (done) => Effect.sync(done),
    ),
  )

const ownerRuntime = Atom.runtime((get) => {
  const key = get(cacheKeyAtom)
  return Layer.fresh(
    layerBrowser({
      endpoint: { baseUrl: () => attached?.url ?? location.origin, token: () => attached?.token ?? null },
      connect: key !== null,
      cache: key === null ? null : { database: RUNTIME_DATABASE, namespace: key },
    }).pipe(Layer.provideMerge(lifetime())),
  )
})

export const owner = createOwnerAtoms(ownerRuntime)

export const registry = AtomRegistry.make()

export function RuntimeProvider(props: { readonly children?: JSX.Element }): JSX.Element {
  return createComponent(RegistryContext.Provider, {
    value: registry,
    get children() {
      return props.children
    },
  })
}

export function observe<A>(
  atom: Atom.Atom<A>,
  deliver: (value: A) => void,
  options?: { readonly immediate?: boolean },
): () => void {
  return registry.subscribe(
    atom,
    (value) => {
      try {
        deliver(value)
      } catch (error) {
        reportError(error)
      }
    },
    options,
  )
}

export function watch<A>(atom: () => Atom.Atom<A>): Accessor<A> {
  const [value, setValue] = createSignal<A>(registry.get(atom()), { equals: false })
  createComputed(() => {
    onCleanup(observe(atom(), (next) => setValue(() => next), { immediate: true }))
  })
  return value
}

export const valueOf = <A, E>(result: AsyncResult.AsyncResult<A, E>): A | undefined =>
  Option.getOrUndefined(AsyncResult.value(result))

export function failureMessage(cause: Cause.Cause<unknown>, fallback: string): string {
  const error = Cause.squash(cause) as { readonly message?: unknown; readonly _tag?: unknown }
  if (error?._tag === "RpcClientError" || error?._tag === "OwnerRpcUnavailableError") return fallback
  return typeof error?.message === "string" && error.message.trim() ? error.message : fallback
}

const errorOf = <A, E>(result: AsyncResult.AsyncResult<A, E>, fallback: string): string | undefined =>
  AsyncResult.isFailure(result) ? failureMessage(result.cause, fallback) : undefined

export function run<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<SettledAsyncResult<A, E>> {
  return runAtomCommand(registry, command, input)
}

export async function attempt<W, A, E>(
  command: AtomCommand<W, A, E>,
  input: W,
  onFailure: (message: string) => void,
  fallback = "Kiko could not do that. Try again.",
): Promise<A | undefined> {
  const result = await run(command, input)
  if (result._tag === "Success") return result.value
  if (!Cause.hasInterruptsOnly(result.cause)) onFailure(failureMessage(result.cause, fallback))
  return undefined
}

export function attachBackend(next: Attachment | null): void {
  const before = attached
  attached = next
  const key = next?.key ?? null
  if (registry.get(cacheKeyAtom) !== key) {
    replaced = closed
    registry.set(cacheKeyAtom, key)
  } else if (next && before && next.token !== before.token) registry.set(owner.retryConnectionAtom, undefined)
}

export function releaseRuntime(): Promise<void> {
  attachBackend(null)
  return replaced
}

export interface Query<A> {
  (): A | undefined
  readonly loading: boolean
  readonly error: string | undefined
  readonly refetch: () => void
}

const IDLE_QUERY = Atom.make(AsyncResult.initial<never, never>()).pipe(Atom.withLabel("kiko-idle-query"))

export function createQuery<A, E>(
  atom: () => Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
  fallback = "Kiko could not load this. Try again.",
): Query<A> {
  const target = createMemo(() => atom() ?? IDLE_QUERY)
  const result = watch(target)
  const value = () => valueOf(result())
  return Object.defineProperties(value, {
    loading: {
      get: () => {
        const current = result()
        return target() !== IDLE_QUERY && value() === undefined && (current._tag === "Initial" || current.waiting)
      },
    },
    error: { get: () => (value() === undefined ? errorOf(result(), fallback) : undefined) },
    refetch: { value: () => registry.refresh(target()) },
  }) as Query<A>
}

export async function call<W, A, E>(command: AtomCommand<W, A, E>, input: W, fallback?: string): Promise<A> {
  const result = await run(command, input)
  if (result._tag === "Success") return result.value
  throw new Error(failureMessage(result.cause, fallback ?? "Kiko could not do that. Try again."))
}

interface EditableQuery<I, A> {
  readonly edit: <B, E, R>(
    input: I,
    apply: (value: A) => A,
    send: Effect.Effect<B, E, R>,
  ) => Effect.Effect<B, E, R | AtomRegistry.AtomRegistry>
}

export function edit<I, A, B>(
  query: EditableQuery<I, A>,
  input: I,
  apply: (value: A) => A,
  send: () => Promise<B>,
): Promise<B> {
  return Effect.runPromise(
    query.edit(input, apply, Effect.promise(send)).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry)),
  )
}

export async function load<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  options: { readonly fallback?: string; readonly refresh?: boolean } = {},
): Promise<A> {
  const result = await executeAtomQuery(registry, atom, { refresh: options.refresh ?? false })
  if (result._tag === "Success") return result.value
  throw new Error(failureMessage(result.cause, options.fallback ?? "Kiko could not load this. Try again."))
}
