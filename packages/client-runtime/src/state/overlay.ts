import type { CommandId } from "@kiko/protocol"

export interface PendingCommand<S> {
  readonly commandId: CommandId
  readonly apply: (snapshot: S) => S
  readonly sequence?: number
  readonly settled?: (snapshot: S) => boolean
}

const isConfirmed = <S>(pending: PendingCommand<S>, shown: S, sequence: number): boolean =>
  (pending.sequence !== undefined && pending.sequence <= sequence) || pending.settled?.(shown) === true

const replay = <S>(snapshot: S, sequence: number, pending: ReadonlyArray<PendingCommand<S>>) => {
  let shown = snapshot
  const kept: Array<PendingCommand<S>> = []
  for (const item of pending) {
    if (isConfirmed(item, shown, sequence)) continue
    kept.push(item)
    shown = item.apply(shown)
  }
  return { shown, kept }
}

export const withPending = <S>(snapshot: S, sequence: number, pending: ReadonlyArray<PendingCommand<S>>): S =>
  replay(snapshot, sequence, pending).shown

export const prunePending = <S>(
  pending: ReadonlyArray<PendingCommand<S>>,
  snapshot: S,
  sequence: number,
): ReadonlyArray<PendingCommand<S>> => {
  const { kept } = replay(snapshot, sequence, pending)
  return kept.length === pending.length ? pending : kept
}
