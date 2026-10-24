import { compatibility, readDescriptor, type Descriptor } from "@kiko/client-runtime/connection"
import { UpdateState } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { createComputed, createRoot, createSignal, on } from "solid-js"
import { apiFetch } from "../lib/api"
import { base } from "../lib/api-base"
import {
  CURRENT,
  type Hold,
  holdOf,
  landed,
  LATEST_POLL_MS,
  noticeOf,
  pillView,
  plan,
  runUpdate,
  skewOf,
  type UpdateBackend,
  type UpdatePhase,
  updateTarget,
} from "../lib/update"
import { APP_VERSION, clientBehind, type Skew } from "../lib/version-skew"
import { connection, type ConnectionView } from "../state/connection"
import { user } from "../state/user"
import { hosted } from "./hosted"

const [phase, setPhase] = createSignal<UpdatePhase>(CURRENT)
const [descriptor, setDescriptor] = createSignal<Descriptor | undefined>()
const [latest, setLatest] = createSignal<string | undefined>()

export const clientIsBehind = () => hosted && clientBehind(APP_VERSION, latest())

export const backendStorage = () => {
  const known = descriptor()
  return known?._tag === "Current" ? known.storage : undefined
}

export const backendVersion = () => {
  const known = descriptor()
  return (known?._tag === "Current" || known?._tag === "Legacy" ? known.version : null) ?? user.build().version
}

export const currentSkew = (): Skew | undefined => skewOf(descriptor(), APP_VERSION)

const blockedBy = (view: ConnectionView): Hold | null =>
  view === "backend-behind" || view === "app-behind" ? view : null

const hold = () =>
  holdOf({ connected: connection.connected(), blocked: blockedBy(connection.view()), descriptor: descriptor() })

export const readOnly = () => hold() !== null

export const notice = () => noticeOf(hold(), phase())

export const view = () => pillView(phase(), readOnly(), clientIsBehind() || currentSkew() === "update")

const learned = Effect.runSync(PubSub.unbounded<Descriptor>())

const reached = (to: string): Effect.Effect<UpdatePhase> =>
  Stream.fromPubSub(learned).pipe(
    Stream.filter((next) => landed(next, to)),
    Stream.runHead,
    Effect.as(CURRENT),
  )

function learn(next: Descriptor): void {
  setDescriptor(next)
  PubSub.publishUnsafe(learned, next)
  if (compatibility(next) === "compatible" && blockedBy(connection.view())) connection.retry()
}

const decodeState = Schema.decodeUnknownOption(UpdateState)

const updateCall = (init: RequestInit = {}) =>
  Effect.tryPromise(async (signal) => {
    const response = await apiFetch("/api/update", { ...init, signal })
    return response.ok ? Option.getOrNull(decodeState(await response.json())) : null
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.orElseSucceed(() => null),
  )

const backend: UpdateBackend = {
  start: (to) =>
    updateCall({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: to }),
    }),
  state: updateCall(),
  descriptor: Effect.suspend(() => readDescriptor((input, init) => fetch(input, init), base() || location.origin)).pipe(
    Effect.tap((next) => Effect.sync(() => learn(next))),
  ),
}

export const refreshBackend = (): Promise<Descriptor> => Effect.runPromise(backend.descriptor)

function begin(to: string, compatible: boolean): void {
  const updating = (stage: "uploading" | "restarting"): UpdatePhase => ({ _tag: "Updating", to, stage, compatible })
  setPhase(updating("uploading"))
  const restarted = Effect.sync(() =>
    setPhase((now) => (now._tag === "Updating" && now.stage === "restarting" ? now : updating("restarting"))),
  )
  void Effect.runPromise(runUpdate(backend, to, restarted).pipe(Effect.raceFirst(reached(to)))).then((next) => {
    setPhase(next)
    if (next._tag !== "Current") return
    if (clientBehind(APP_VERSION, to)) return location.reload()
    showToastV2({ title: "Kiko is updated", description: `Now on ${to}.`, variant: "success" })
  })
}

function consider(next: Descriptor, to: string, automatic: boolean): void {
  const now = phase()
  if (now._tag === "Updating") return
  const step = plan(next, to)
  if (step._tag === "Reconnect") return void setPhase({ _tag: "NeedsReconnect", reason: step.reason })
  if (step._tag === "Start") {
    if (!automatic || now._tag === "Current") begin(step.to, step.compatible)
    return
  }
  if (next._tag === "Current") setPhase(CURRENT)
}

createRoot(() =>
  createComputed(
    on(connection.view, (view) => {
      if (view === "connected" || blockedBy(view))
        void refreshBackend().then((next) => consider(next, APP_VERSION, true))
    }),
  ),
)

export async function startUpdate(): Promise<void> {
  const to = updateTarget(APP_VERSION, latest())
  const next = await refreshBackend()
  if (landed(next, to) && clientBehind(APP_VERSION, to)) return location.reload()
  consider(next, to, false)
}

export async function refreshLatest(): Promise<void> {
  if (!hosted) return
  const res = await fetch("/releases/latest-owner.json", { cache: "no-store" }).catch(() => null)
  const body = (res?.ok ? await res.json().catch(() => null) : null) as { version?: unknown } | null
  if (typeof body?.version !== "string") return
  const was = clientIsBehind()
  setLatest(body.version)
  if (!was && clientIsBehind() && phase()._tag !== "Updating") {
    showToastV2({
      title: `Kiko ${body.version} is ready`,
      description: "Update in one click.",
      action: { label: "Update", onClick: () => void startUpdate() },
    })
  }
}

let watching = false

export function watchLatest() {
  if (watching || !hosted) return
  watching = true
  void refreshLatest()
  const visible = () => document.visibilityState === "visible" && void refreshLatest()
  document.addEventListener("visibilitychange", visible)
  setInterval(() => document.hidden || void refreshLatest(), LATEST_POLL_MS)
}

export async function checkForUpdates(): Promise<void> {
  const [next] = await Promise.all([refreshBackend(), refreshLatest()])
  if (next._tag === "Unreachable")
    return void showToastV2({
      title: "Kiko could not reach your backend",
      description: "Check your connection, then try again.",
    })
  if (clientIsBehind() || currentSkew() !== "ok")
    return void showToastV2({ title: "An update is available", variant: "info" })
  showToastV2({ title: "Kiko is up to date", variant: "success" })
}
