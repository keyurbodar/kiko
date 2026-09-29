export const PRELOAD_MARGIN_PX = 600

export type LoadEarlierState = {
  readonly armed: boolean
  readonly isLoading: boolean
  readonly hasOlder: boolean
}

export type LoadEarlierDecision = {
  readonly armed: boolean
  readonly shouldLoad: boolean
}

export function decideLoadEarlier(
  intersecting: boolean,
  state: LoadEarlierState,
): LoadEarlierDecision {
  if (!state.hasOlder) return { armed: false, shouldLoad: false }
  if (state.isLoading) return { armed: state.armed, shouldLoad: false }
  if (!intersecting) return { armed: true, shouldLoad: false }
  if (!state.armed) return { armed: false, shouldLoad: false }
  return { armed: false, shouldLoad: true }
}
