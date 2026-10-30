import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"

export type SettledAsyncResult<A, E> = AsyncResult.Success<A, E> | AsyncResult.Failure<A, E>

export interface AtomCommand<W, A, E> {
  readonly label: string
  readonly run: (registry: AtomRegistry.AtomRegistry, input: W) => Promise<SettledAsyncResult<A, E>>
}

export type AtomCommandConcurrency<W> =
  | { readonly mode: "parallel" }
  | { readonly mode: "serial" | "singleFlight"; readonly key: (input: W) => string }

async function settle<A, E>(execute: () => Promise<SettledAsyncResult<A, E>>): Promise<SettledAsyncResult<A, E>> {
  try {
    return await execute()
  } catch (defect) {
    return AsyncResult.failure(Cause.die(defect))
  }
}

const lanes = new WeakMap<AtomRegistry.AtomRegistry, Map<string, Promise<unknown>>>()

function laneOf(registry: AtomRegistry.AtomRegistry): Map<string, Promise<unknown>> {
  let lane = lanes.get(registry)
  if (lane === undefined) lanes.set(registry, (lane = new Map()))
  return lane
}

function schedule<W, A, E>(
  registry: AtomRegistry.AtomRegistry,
  concurrency: AtomCommandConcurrency<W>,
  input: W,
  execute: () => Promise<SettledAsyncResult<A, E>>,
): Promise<SettledAsyncResult<A, E>> {
  if (concurrency.mode === "parallel") return execute()
  const lane = laneOf(registry)
  const key = `${concurrency.mode}:${concurrency.key(input)}`
  const previous = lane.get(key) as Promise<SettledAsyncResult<A, E>> | undefined
  if (previous !== undefined && concurrency.mode === "singleFlight") return previous
  const current = previous === undefined ? execute() : previous.then(execute, execute)
  lane.set(key, current)
  const release = () => {
    if (lane.get(key) === current) lane.delete(key)
  }
  void current.then(release, release)
  return current
}

export async function executeAtomQuery<A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  options: { readonly refresh?: boolean } = {},
): Promise<SettledAsyncResult<A, E>> {
  const query = Effect.scoped(
    Effect.gen(function* () {
      yield* AtomRegistry.mount(registry, atom)
      if (options.refresh) {
        const current = registry.get(atom)
        if (current._tag !== "Initial" && !current.waiting) registry.refresh(atom)
      }
      return yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })
    }),
  )
  return settle(async () => AsyncResult.fromExit(await Effect.runPromiseExit(query)) as SettledAsyncResult<A, E>)
}

export function createRuntimeCommand<R, ER, W, A, E>(
  runtime: Atom.AtomRuntime<R, ER>,
  options: {
    readonly label: string
    readonly execute: (input: W) => Effect.Effect<A, E, R | AtomRegistry.AtomRegistry>
    readonly concurrency?: AtomCommandConcurrency<W>
  },
): AtomCommand<W, A, E | ER> {
  const concurrency = options.concurrency ?? { mode: "parallel" as const }
  return {
    label: options.label,
    run: (registry, input) =>
      settle(() =>
        schedule(registry, concurrency, input, () =>
          executeAtomQuery(registry, runtime.atom(options.execute(input)).pipe(Atom.withLabel(options.label))),
        ),
      ),
  }
}

export interface AtomCommandReporter {
  readonly warn: (message: string, cause: Cause.Cause<unknown>) => void
  readonly error: (message: string, cause: Cause.Cause<unknown>) => void
}

function reportAtomCommandResult(
  label: string,
  result: SettledAsyncResult<unknown, unknown>,
  reporter: AtomCommandReporter = console,
): void {
  if (AsyncResult.isSuccess(result) || Cause.hasInterruptsOnly(result.cause)) return
  if (Cause.hasDies(result.cause)) reporter.error(`[atom-command] ${label} defected`, result.cause)
  else reporter.warn(`[atom-command] ${label} failed`, result.cause)
}

export async function runAtomCommand<W, A, E>(
  registry: AtomRegistry.AtomRegistry,
  command: AtomCommand<W, A, E>,
  input: W,
  reporter?: AtomCommandReporter,
): Promise<SettledAsyncResult<A, E>> {
  const result = await settle(() => command.run(registry, input))
  reportAtomCommandResult(command.label, result, reporter)
  return result
}
