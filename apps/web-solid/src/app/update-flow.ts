import { createComputed, createRoot, createSignal, on } from "solid-js"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { PROTOCOL, speaksRpc, type UserToClient } from "@kiko/protocol"
import { apiFetch } from "../lib/api"
import { base, getToken } from "../lib/api-base"
import { showFailure } from "../lib/errors"
import {
  autoUpdateKey,
  checkStall,
  LATEST_POLL_MS,
  landed,
  pillView,
  reduceUpdate,
  RESTART_ERROR,
  RESTART_LIMIT_MS,
  RESTART_POLL_MS,
  restartStep,
  sent,
  STALL_MS,
  type UpdateProgress,
  updateTarget,
} from "../lib/update"
import { APP_VERSION, type BackendBuild, backendSkew, clientBehind, type Skew } from "../lib/version-skew"
import { connection } from "../state/connection"
import { attempt, owner } from "../state/runtime"
import { onUserSignal, user } from "../state/user"
import { hosted } from "./hosted"
import { startLegacyUpdate } from "./legacy-update"

const [progress, setProgress] = createSignal<UpdateProgress>(null)
const [latest, setLatest] = createSignal<string | undefined>()
const [fetched, setFetched] = createSignal<BackendBuild | null | undefined>()

export const clientIsBehind = () => hosted && clientBehind(APP_VERSION, latest())

export const backendStorage = () => fetched()?.storage

export const backendVersion = () => fetched()?.version ?? user.build().version
const clientBuild = { version: APP_VERSION, protocol: PROTOCOL }
export const currentSkew = (): Skew | undefined => {
  const view = connection.view()
  if (view === "outdated" || view === "backend-outdated") return "blocked"
  const build = fetched() ?? user.build()
  return build.protocol === undefined && build.version === undefined ? undefined : backendSkew(clientBuild, build)
}
function set(next: UpdateProgress) {
  setProgress(next)
  if (next?.stage === "failed") showFailure(next.error ?? "The update failed. Try again.")
}

let target = APP_VERSION
let polling = false

async function awaitRestart() {
  if (polling) return
  polling = true
  try {
    for (
      const until = Date.now() + RESTART_LIMIT_MS;
      Date.now() < until;
      await new Promise((r) => setTimeout(r, RESTART_POLL_MS))
    ) {
      const step = restartStep(target, await refreshBackend(), connection.state()?.phase)
      if (step === "reconnect") connection.retry()
      if (step !== "done") continue
      if (clientIsBehind()) return location.reload()
      set(null)
      showToastV2({ title: "Kiko is updated", description: `Now on ${backendVersion()}.`, variant: "success" })
      return
    }
    set({ stage: "failed", error: RESTART_ERROR })
  } finally {
    polling = false
  }
}

function applyState(frame: Extract<UserToClient, { t: "update.state" }>) {
  set(reduceUpdate(frame))
  if (frame.stage === "restarting") void awaitRestart()
}

function sendLegacyStart() {
  const token = getToken()
  if (!token) return set({ stage: "failed", error: "Sign in again, then update." })
  startLegacyUpdate({ httpBase: base() || location.origin, token, version: target, onState: applyState })
}

let wired = false
function wire() {
  if (wired) return
  wired = true
  onUserSignal("update.state", applyState)
  createRoot(() =>
    createComputed(
      on(
        connection.connected,
        (connected) => {
          const stage = progress()?.stage
          if (connected && (stage === "uploading" || stage === "restarting")) void awaitRestart()
        },
        { defer: true },
      ),
    ),
  )
}

export async function startUpdate() {
  wire()
  target = updateTarget(APP_VERSION, latest())
  set(sent(Date.now()))
  const build = await refreshBackend()
  if (build && build.protocol !== PROTOCOL) {
    set(null)
    showToastV2({
      title: "Reconnect Cloudflare to install this version",
      description: "This upgrade starts fresh. Your existing chats will be removed after you confirm in the installer.",
      action: { label: "Reconnect Cloudflare", onClick: () => location.assign("/connect?reconnect=1") },
    })
    return
  }
  const legacy = build !== null && !speaksRpc(build)
  if (!legacy && landed(target, build?.version)) {
    if (clientIsBehind()) return location.reload()
    return set(null)
  }
  if (legacy) sendLegacyStart()
  else if (!connection.connected())
    return set({ stage: "failed", error: "Kiko is offline. Try again when it reconnects." })
  else
    void attempt(owner.commands.updateStart, { version: target as never }, (error) => set({ stage: "failed", error }))
  setTimeout(() => {
    const p = progress()
    const stalled = checkStall(p, Date.now())
    if (stalled !== p) set(stalled)
  }, STALL_MS)
}

export async function refreshBackend(): Promise<BackendBuild | null> {
  const res = await apiFetch("/api/version").catch(() => null)
  const build = res?.ok ? ((await res.json().catch(() => null)) as BackendBuild | null) : null
  if (build) setFetched(build)
  if (build && speaksRpc(build) && connection.view() === "backend-outdated") connection.retry()
  return build
}

createRoot(() => createComputed(on(connection.view, (view) => view === "backend-outdated" && void refreshBackend())))

const AUTO_UPDATED_KEY = "kiko:auto-updated"

createRoot(() =>
  createComputed(
    on(
      () => fetched() ?? user.build(),
      (build) => {
        const key = progress() ? null : autoUpdateKey(clientBuild, build)
        if (!key || sessionStorage.getItem(AUTO_UPDATED_KEY) === key) return
        sessionStorage.setItem(AUTO_UPDATED_KEY, key)
        void startUpdate()
      },
    ),
  ),
)

export async function refreshLatest(): Promise<void> {
  if (!hosted) return
  const res = await fetch("/releases/latest-owner.json", { cache: "no-store" }).catch(() => null)
  const body = (res?.ok ? await res.json().catch(() => null) : null) as { version?: unknown } | null
  if (typeof body?.version !== "string") return
  const was = clientIsBehind()
  setLatest(body.version)
  if (!was && clientIsBehind() && !progress()) {
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
  window.addEventListener("focus", () => void refreshLatest())
  document.addEventListener("visibilitychange", visible)
  setInterval(() => void refreshLatest(), LATEST_POLL_MS)
}

export async function checkForUpdates(): Promise<void> {
  const [build] = await Promise.all([refreshBackend(), refreshLatest()])
  if (!build) return void showFailure("Could not reach your backend. Try again.")
  if (clientIsBehind() || currentSkew() !== "ok")
    return void showToastV2({ title: "An update is available", variant: "info" })
  showToastV2({ title: "Kiko is up to date", variant: "success" })
}

export const view = () => pillView(currentSkew(), clientIsBehind(), progress())
