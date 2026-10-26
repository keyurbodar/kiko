import * as Option from "effect/Option"

export type StreamStatus = "empty" | "cached" | "synchronizing" | "live" | "missing"

export interface StreamState<S> {
  readonly data: Option.Option<S>
  readonly sequence: number
  readonly status: StreamStatus
  readonly error: Option.Option<string>
}

export type StreamItem<S, E, G> =
  | { readonly kind: "snapshot"; readonly snapshot: S }
  | { readonly kind: "event"; readonly sequence: number; readonly event: E }
  | { readonly kind: "signal"; readonly signal: G }
  | { readonly kind: "synchronized" }

export interface StreamReducer<S, E, G> {
  readonly snapshotSequence: (snapshot: S) => number
  readonly applyEvent: (data: S, event: E, sequence: number) => S
  readonly applySignal?: (data: S, signal: G) => S
  readonly unsequenced?: (event: E) => boolean
}

export const emptyStreamState = <S>(): StreamState<S> => ({
  data: Option.none(),
  sequence: 0,
  status: "empty",
  error: Option.none(),
})

export const cachedStreamState = <S>(snapshot: S, sequence: number): StreamState<S> => ({
  data: Option.some(snapshot),
  sequence,
  status: "cached",
  error: Option.none(),
})

const offline = <S>(state: StreamState<S>): StreamState<S>["status"] =>
  state.status === "missing" ? "missing" : Option.isSome(state.data) ? "cached" : "empty"

export const markSynchronizing = <S>(state: StreamState<S>): StreamState<S> =>
  state.status === "missing" ? state : { ...state, status: "synchronizing", error: Option.none() }

export const markDisconnected = <S>(state: StreamState<S>): StreamState<S> => ({ ...state, status: offline(state) })

export const markFailed = <S>(state: StreamState<S>, message: string): StreamState<S> => ({
  ...state,
  status: offline(state),
  error: Option.some(message),
})

export const markMissing = <S>(state: StreamState<S>): StreamState<S> => ({
  data: Option.none(),
  sequence: state.sequence,
  status: "missing",
  error: Option.none(),
})

function applyEvent<S, E, G>(
  state: StreamState<S>,
  item: Extract<StreamItem<S, E, G>, { kind: "event" }>,
  reducer: StreamReducer<S, E, G>,
): StreamState<S> {
  const unsequenced = reducer.unsequenced?.(item.event) === true
  if (unsequenced ? item.sequence < state.sequence : item.sequence <= state.sequence) return state
  const sequence = unsequenced ? state.sequence : item.sequence
  if (Option.isNone(state.data)) return { ...state, sequence }
  return { ...state, sequence, data: Option.some(reducer.applyEvent(state.data.value, item.event, sequence)) }
}

function applyStreamItem<S, E, G>(
  state: StreamState<S>,
  item: StreamItem<S, E, G>,
  reducer: StreamReducer<S, E, G>,
): StreamState<S> {
  switch (item.kind) {
    case "snapshot":
      return {
        ...state,
        data: Option.some(item.snapshot),
        sequence: reducer.snapshotSequence(item.snapshot),
        status: state.status === "live" ? "live" : "synchronizing",
        error: Option.none(),
      }
    case "event":
      return applyEvent(state, item, reducer)
    case "signal":
      return reducer.applySignal === undefined || Option.isNone(state.data)
        ? state
        : { ...state, data: Option.some(reducer.applySignal(state.data.value, item.signal)) }
    case "synchronized":
      return Option.isSome(state.data) && Option.isNone(state.error) ? { ...state, status: "live" } : state
  }
}

export const applyStreamItems = <S, E, G>(
  state: StreamState<S>,
  items: ReadonlyArray<StreamItem<S, E, G>>,
  reducer: StreamReducer<S, E, G>,
): StreamState<S> => items.reduce((current, item) => applyStreamItem(current, item, reducer), state)
