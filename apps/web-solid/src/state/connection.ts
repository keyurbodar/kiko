import type { SupervisorConnectionState } from "@kiko/client-runtime/connection"
import { createComputed, createMemo, createRoot, createSignal, onCleanup, type Accessor } from "solid-js"
import { owner, registry, valueOf, watch } from "./runtime"

const RECONNECTING_DELAY_MS = 2_000
const DISCONNECTED_DELAY_MS = 20_000
const STATUS_MIN_DELAY_MS = 400
const STATUS_MIN_VISIBLE_MS = 400

export type ConnectionView =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected"
  | "signed-out"
  | "app-behind"
  | "backend-behind"

function blockedView(failure: SupervisorConnectionState["lastFailure"]): ConnectionView {
  if (failure?._tag !== "ConnectionBlockedError" || failure.reason !== "unsupported") return "signed-out"
  return failure.serverUpdateRequired ? "backend-behind" : "app-behind"
}

function viewOf(state: SupervisorConnectionState, downFor: number): ConnectionView {
  if (state.phase === "connected") return "connected"
  if (state.phase === "blocked") return blockedView(state.lastFailure)
  if (state.generation === 0 && state.attempt <= 1 && state.lastFailure === null) return "connecting"
  if (downFor >= DISCONNECTED_DELAY_MS) return "disconnected"
  return downFor >= RECONNECTING_DELAY_MS ? "reconnecting" : "connecting"
}

function createElapsed(since: Accessor<number | null>): Accessor<number> {
  const [now, setNow] = createSignal(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  createComputed(() => {
    clearInterval(timer)
    if (since() === null) return
    setNow(Date.now())
    timer = setInterval(() => setNow(Date.now()), 1_000)
  })
  onCleanup(() => clearInterval(timer))
  return () => {
    const start = since()
    return start === null ? 0 : now() - start
  }
}

export function createDelayedStatus<T>(value: Accessor<T | null>): Accessor<T | null> {
  const [shown, setShown] = createSignal<T | null>(null)
  let pending: ReturnType<typeof setTimeout> | undefined
  let visibleAt = 0
  createComputed(() => {
    const next = value()
    clearTimeout(pending)
    if (next !== null) {
      if (shown() !== null) return void setShown(() => next)
      pending = setTimeout(() => {
        visibleAt = Date.now()
        setShown(() => next)
      }, STATUS_MIN_DELAY_MS)
      return
    }
    const left = STATUS_MIN_VISIBLE_MS - (Date.now() - visibleAt)
    if (shown() === null || left <= 0) return void setShown(null)
    pending = setTimeout(() => setShown(null), left)
  })
  onCleanup(() => clearTimeout(pending))
  return shown
}

export const connection = createRoot(() => {
  const state = watch(() => owner.connectionAtom)
  const current = createMemo(() => valueOf(state()))
  const [downSince, setDownSince] = createSignal<number | null>(null)
  createComputed(() => {
    const phase = current()?.phase
    if (phase === undefined || phase === "connected") return void setDownSince(null)
    if (downSince() === null) setDownSince(Date.now())
  })
  const elapsed = createElapsed(downSince)
  const view = createMemo<ConnectionView>(() => {
    const s = current()
    return s === undefined ? "connecting" : viewOf(s, elapsed())
  })
  return {
    state: current,
    view,
    connected: () => current()?.phase === "connected",
    retry: () => registry.set(owner.retryConnectionAtom, undefined),
  }
})
