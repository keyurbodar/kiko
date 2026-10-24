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
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { createComponent, createComputed, createMemo, createSignal, onCleanup, type Accessor, type JSX } from "solid-js"
import { session } from "../app/session"
import { base, getToken } from "../lib/api-base"

const signedInAs = () => {
  const current = session()
  return current.status === "signed-in" ? current.user.id : null
}

const ownerIdAtom = Atom.make<string | null>(signedInAs()).pipe(Atom.keepAlive, Atom.withLabel("kiko-owner-id"))

const runtimeNamespace = (ownerId: string) => `kiko:warm:${ownerId}`

const ownerRuntime = Atom.runtime((get) =>
  layerBrowser({
    endpoint: { baseUrl: () => base() || location.origin, token: getToken },
    namespace: runtimeNamespace(get(ownerIdAtom) ?? "signed-out"),
  }),
)

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

export function watch<A>(atom: () => Atom.Atom<A>): Accessor<A> {
  const [value, setValue] = createSignal<A>(registry.get(atom()), { equals: false })
  createComputed(() => {
    onCleanup(registry.subscribe(atom(), (next) => setValue(() => next), { immediate: true }))
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

export function followOwner(ownerId: string | null): void {
  if (registry.get(ownerIdAtom) !== ownerId) registry.set(ownerIdAtom, ownerId)
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
