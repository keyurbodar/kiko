import { createComputed, createSignal } from "solid-js"

const values = new Map<object, unknown>()
const listeners = new Map<object, Set<() => void>>()

function listen(target: object, deliver: () => void): () => void {
  let held = listeners.get(target)
  if (!held) {
    held = new Set()
    listeners.set(target, held)
  }
  const set = held
  set.add(deliver)
  return () => void set.delete(deliver)
}

export function setAtomValue(target: object, value: unknown): void {
  values.set(target, value)
  for (const deliver of listeners.get(target) ?? []) deliver()
}

export function watch<T>(source: () => unknown): () => T | undefined {
  const [value, setValue] = createSignal<T | undefined>(undefined, { equals: false })
  let current: object | undefined
  let release: (() => void) | undefined
  const deliver = () => setValue(() => values.get(current as object) as T | undefined)
  createComputed(() => {
    const next = source() as object
    if (next === current) return
    if (release) release()
    current = next
    release = listen(next, deliver)
    deliver()
  })
  return value
}

export function observe(
  target: object,
  deliver: (value: unknown) => void,
  options?: { readonly immediate?: boolean },
): () => void {
  const read = () => deliver(values.get(target))
  const release = listen(target, read)
  if (options?.immediate) read()
  return release
}

export const valueOf = <A>(value: A): A => value

export function attempt(): Promise<undefined> {
  return Promise.resolve(undefined)
}

export function run(): Promise<undefined> {
  return Promise.resolve(undefined)
}

export function attachBackend(): void {}

export function releaseRuntime(): Promise<void> {
  return Promise.resolve()
}

export function failureMessage(): string {
  return ""
}

export const registry = {
  mount: () => () => {},
  set: () => {},
  get: () => undefined,
  subscribe: () => () => {},
  refresh: () => {},
}

const atom = (name: string) => ({ name })
const roomAtoms = new Map<string, object>()
const cachedAtoms = new Map<string, object>()
const signalAtoms = new Map<string, object>()
const command = () => undefined

function family(atoms: Map<string, object>, prefix: string, id: string): object {
  const held = atoms.get(id)
  if (held) return held
  const fresh = atom(`${prefix}:${id}`)
  atoms.set(id, fresh)
  return fresh
}

export const owner = {
  connectionAtom: atom("connection"),
  userAtom: atom("user"),
  retryConnectionAtom: atom("retry"),
  roomAtom: (id: string) => family(roomAtoms, "room", id),
  cachedRoomAtom: (id: string) => family(cachedAtoms, "cached", id),
  roomSignalAtom: (id: string) => family(signalAtoms, "signal", id),
  commands: new Proxy({}, { get: () => command }) as Record<string, () => undefined>,
}

values.set(owner.connectionAtom, {
  desired: true,
  network: "online",
  phase: "connected",
  stage: null,
  attempt: 1,
  generation: 1,
  lastFailure: null,
  retryAt: null,
})
values.set(owner.userAtom, undefined)
