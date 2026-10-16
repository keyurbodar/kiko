import { createEffect, createRoot, createSignal } from "solid-js"
import { apiFetch } from "../../lib/api"
import { connectedProviders } from "../../settings/connected"
import { listProviders } from "../../settings/credentials"
import { hasModelProvider } from "../../settings/provider-kinds"
import { hosted } from "../hosted"
import { session } from "../session"
import { advance, stepFor, type Move, type Step } from "./steps"

const key = (userId: string) => `kiko:first-run:${userId}`

function read(userId: string): Step | null {
  try {
    const value = localStorage.getItem(key(userId))
    return value === "connect" || value === "model" || value === "done" ? value : null
  } catch {
    return null
  }
}

function write(userId: string, step: Step): void {
  try {
    localStorage.setItem(key(userId), step)
  } catch {}
}

const userId = () => {
  const s = session()
  return s.status === "signed-in" ? s.user.id : null
}

const [saved, setSaved] = createSignal<{ userId: string; step: Step | null } | null>(null)
const [probe, setProbe] = createSignal<{ userId: string; connected: boolean; onboarded: boolean } | null>(null)
const [fresh, setFresh] = createSignal(false)

/** A browser that has signed in before skips the welcome cover and opens on sign in. */
function signedInBefore(): boolean {
  try {
    return localStorage.getItem("kiko:backend") !== null || Object.keys(localStorage).some((k) => k.startsWith("kiko:first-run:"))
  } catch {
    return false
  }
}

const [started, setStarted] = createSignal(signedInBefore())
const [needsBackend, setNeedsBackend] = createSignal(hosted && /^\/connect(\/callback)?$/.test(location.pathname))

export const getStarted = () => setStarted(true)

/** Something on the welcome screen is working: a sign-in, a modal loading, an install. The backdrop pulses. */
export const [working, setWorking] = createSignal(false)
/** Hosted only: Clerk signed the person in, and they have no backend yet. */
export const installBackend = () => setNeedsBackend(true)

/** Call as a sign-in goes up, so the first frame after it is already the connect step. */
export const enteringWithCode = () => setFresh(true)
export const codeFailed = () => setFresh(false)

const savedStep = (): Step | null => {
  const id = userId()
  if (!id) return null
  const s = saved()
  return s?.userId === id ? s.step : read(id)
}

/** The step to show now. "done" means first run has nothing to show. */
export function currentStep(): Step {
  const id = userId()
  const known = probe()?.userId === id && id !== null
  return stepFor({
    signedIn: id !== null,
    hosted,
    started: started(),
    needsBackend: needsBackend(),
    saved: savedStep(),
    fresh: fresh(),
    known,
    connected: hasModelProvider(connectedProviders()) || (known && probe()!.connected),
    onboarded: known && probe()!.onboarded,
  })
}

export function move(how: Move): void {
  const id = userId()
  if (!id) return
  const step = advance(currentStep(), how)
  write(id, step)
  setSaved({ userId: id, step })
  if (step === "done") void remember()
}

/** Tells the server first run is over, so a browser with nothing saved, or another device, skips it too. */
const remember = () =>
  apiFetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ onboarded: true }) }).catch(() => {})

async function onboardedOnServer(): Promise<boolean> {
  const res = await apiFetch("/api/settings")
  return res.ok && ((await res.json()) as { onboarded?: unknown }).onboarded === true
}

createRoot(() => {
  // Ask the server once for a browser that has no saved step, so a returning owner with a key never sees first run.
  createEffect(() => {
    const id = userId()
    if (!id || savedStep() || probe()?.userId === id) return
    void Promise.all([listProviders(), onboardedOnServer()])
      .then(([list, onboarded]) => setProbe({ userId: id, connected: hasModelProvider(list), onboarded }))
      .catch(() => {})
  })
  // Remember the step, so a reload resumes it and a finished first run stays finished.
  createEffect(() => {
    const id = userId()
    if (!id) return
    const step = currentStep()
    if (step === savedStep()) return
    if (savedStep() === null && probe()?.userId !== id) return
    write(id, step)
    setSaved({ userId: id, step })
  })
})
