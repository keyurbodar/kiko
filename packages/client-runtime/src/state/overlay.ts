import type { CommandId } from "@kiko/protocol"

export interface PendingCommand<S> {
  readonly commandId: CommandId
  readonly apply: (snapshot: S) => S
  readonly sequence?: number
  readonly settled?: (snapshot: S) => boolean
}

const isConfirmed = <S>(pending: PendingCommand<S>, snapshot: S, sequence: number): boolean =>
  (pending.sequence !== undefined && pending.sequence <= sequence) || pending.settled?.(snapshot) === true

export function withPending<S>(snapshot: S, sequence: number, pending: ReadonlyArray<PendingCommand<S>>): S {
  return pending.reduce(
    (current, item) => (isConfirmed(item, snapshot, sequence) ? current : item.apply(current)),
    snapshot,
  )
}

export const prunePending = <S>(
  pending: ReadonlyArray<PendingCommand<S>>,
  snapshot: S,
  sequence: number,
): ReadonlyArray<PendingCommand<S>> => {
  const kept = pending.filter((item) => !isConfirmed(item, snapshot, sequence))
  return kept.length === pending.length ? pending : kept
}
