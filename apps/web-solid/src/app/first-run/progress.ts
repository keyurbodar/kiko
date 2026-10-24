import { createEffect, createRoot, createSignal } from "solid-js"
import { connectedProviders } from "../../settings/connected"
import { hasModelProvider } from "../../settings/provider-kinds"
import { load, owner, run } from "../../state/runtime"
import { hosted } from "../hosted"
import type { Phase } from "../phase"
import { phase } from "../session"
import { advance, onboardingStep, type Move, type Step } from "./steps"

const ON_CLOUDFLARE: ReadonlySet<Phase["_tag"]> = new Set(["NeedsBackend", "Installing", "Unreachable"])

interface Probe {
  readonly key: string
  readonly connected: boolean
  readonly onboarded: boolean
}

const [chosen, setChosen] = createSignal<{ readonly key: string; readonly step: Step } | null>(null)
const [probe, setProbe] = createSignal<Probe | null>(null)
const [fresh, setFresh] = createSignal(phase()._tag !== "Ready")

export const [working, setWorking] = createSignal(false)
export const [finished, setFinished] = createSignal(false)

export const enteringFresh = () => setFresh(true)

const readyKey = (): string | null => {
  const current = phase()
  return current._tag === "Ready" ? current.backend.key : null
}

const chosenStep = (key: string): Step | null => {
  const current = chosen()
  return current?.key === key ? current.step : null
}

const probed = (key: string): Probe | null => {
  const current = probe()
  return current?.key === key ? current : null
}

export function currentStep(): Step {
  const current = phase()
  if (current._tag !== "Ready") return hosted && ON_CLOUDFLARE.has(current._tag) ? "cloudflare" : "sign-in"
  const key = current.backend.key
  const known = probed(key)
  return onboardingStep({
    chosen: chosenStep(key),
    fresh: fresh(),
    known: known !== null,
    connected: hasModelProvider(connectedProviders()) || (known?.connected ?? false),
    onboarded: known?.onboarded ?? false,
  })
}

function remember() {
  return run(owner.commands.settingsUpdate, { patch: { onboarded: true } })
}

export function setStep(step: Step): void {
  const key = readyKey()
  if (!key) return
  setChosen({ key, step })
  if (step === "done") void remember()
}

export function move(how: Move): void {
  setStep(advance(currentStep(), how))
}

async function onboardedOnServer(): Promise<boolean> {
  return (await load(owner.queries.settings(undefined))).onboarded === true
}

createRoot(() => {
  createEffect(() => {
    const key = readyKey()
    if (!key || chosenStep(key) === "done" || probed(key)) return
    void Promise.all([load(owner.queries.credentials(undefined)), onboardedOnServer()])
      .then(([list, onboarded]) => {
        if (readyKey() === key) setProbe({ key, connected: hasModelProvider(list), onboarded })
      })
      .catch(() => {})
  })
  createEffect(() => {
    const key = readyKey()
    if (!key) return
    const step = currentStep()
    const before = chosenStep(key)
    if (step === before || (before === null && !probed(key))) return
    setChosen({ key, step })
  })
})
