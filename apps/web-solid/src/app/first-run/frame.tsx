import { useLocation, useNavigate } from "@tanstack/solid-router"
import { For, Match, Show, Switch, createEffect, onCleanup } from "solid-js"
import "./first-run.css"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronLeftIcon } from "@kiko/ui/icons"
import { hosted } from "../hosted"
import { phase, signOut } from "../session"
import { Backdrop } from "./backdrop"
import { BackendStep, preloadConnect } from "./backend-step"
import { ClerkStep } from "./clerk-step"
import { ConnectStep } from "./connect-step"
import { DoneStep } from "./done-step"
import { Illustration, type IllustrationName } from "./illustrations"
import { Perch } from "./mascots"
import { ModelStep } from "./model-step"
import { currentStep, dismissResume, finished, resumed, setStep, working } from "./progress"
import { indexOf, resumeLine, stepsFor, type Step } from "./steps"
import { AccessCode } from "./welcome"

const STEPS = stepsFor(hosted)

const ART: Record<Exclude<Step, "done">, { name: IllustrationName; caption: string }> = {
  "sign-in": { name: "envelope", caption: hosted ? "Just your name and email" : "Your code stays on your server" },
  cloudflare: { name: "plug", caption: "Plugs into your Cloudflare" },
  connect: { name: "pot", caption: "Cooking up some brains" },
  model: { name: "chat", caption: "You can change it any time" },
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest("input, textarea, select, button, a, [contenteditable]") !== null

export default function FirstRun() {
  const location = useLocation()
  const navigate = useNavigate()
  const at = () => (finished() ? STEPS.length : indexOf(currentStep(), hosted))
  const awake = () => (finished() ? 4 : Math.round((Math.max(at(), 0) * 4) / STEPS.length))
  const art = () => {
    const step = currentStep()
    return step === "done" ? null : ART[step]
  }

  if (hosted) preloadConnect()

  createEffect(() => {
    const path = location().pathname
    if (path !== "/welcome" && path !== "/connect/callback") void navigate({ to: "/welcome", replace: true })
  })

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.defaultPrevented || typing(event.target)) return
    document.querySelector<HTMLButtonElement>(".ob-left [data-cta]:not(:disabled)")?.click()
  }
  document.addEventListener("keydown", onKey)
  onCleanup(() => document.removeEventListener("keydown", onKey))

  return (
    <div
      class="welcome h-dvh"
      data-component="first-run"
      data-step={currentStep()}
      data-finished={finished() ? "" : undefined}
    >
      <Backdrop awake={awake()} signedIn={phase()._tag !== "SignedOut" && phase()._tag !== "SigningOut"} />
      <div class="ob-wordmark" role="img" aria-label="Kiko">
        Kiko
      </div>
      <div class="ob-stage">
        <div class="ob-sheet" data-done={finished() ? "" : undefined}>
          <Perch awake={awake()} celebrating={finished()} />
          <div class="ob-left">
            <Show when={at() >= 0 && !finished()}>
              <div class="ob-head">
                <ol class="ob-segs" aria-label="Setup progress">
                  <For each={STEPS}>
                    {(s, i) => (
                      <li
                        data-state={i() < at() ? "done" : i() === at() ? "current" : "next"}
                        aria-current={i() === at() ? "step" : undefined}
                        aria-label={s.label}
                      />
                    )}
                  </For>
                </ol>
                <span class="ob-count">
                  {Math.min(at() + 1, STEPS.length)} of {STEPS.length}
                </span>
                <Show when={currentStep() === "model"}>
                  <button type="button" class="ob-back" data-action="first-run-back" onClick={() => setStep("connect")}>
                    <RemixIcon icon={ChevronLeftIcon} size={13} />
                    Back
                  </button>
                </Show>
                <Show when={currentStep() === "connect"}>
                  <button
                    type="button"
                    class="ob-back"
                    data-action="first-run-back"
                    disabled={working()}
                    onClick={() => void signOut()}
                  >
                    <RemixIcon icon={ChevronLeftIcon} size={13} />
                    Back
                  </button>
                </Show>
                <Show when={currentStep() === "cloudflare"}>
                  <button
                    type="button"
                    class="ob-back"
                    data-action="sign-out"
                    disabled={working()}
                    onClick={() => void signOut()}
                  >
                    Sign out
                  </button>
                </Show>
              </div>
            </Show>
            <Show when={resumed()}>
              {(step) => (
                <div class="ob-resume" role="status" data-component="first-run-resume">
                  <p>
                    <b>Welcome back.</b> {resumeLine(step(), hosted)}
                  </p>
                  <button type="button" data-action="resume-dismiss" onClick={dismissResume}>
                    Pick up where I left
                  </button>
                </div>
              )}
            </Show>
            <Show when={currentStep()} keyed>
              {(step) => (
                <Switch>
                  <Match when={step === "sign-in"}>{hosted ? <ClerkStep /> : <AccessCode />}</Match>
                  <Match when={step === "cloudflare"}>
                    <BackendStep />
                  </Match>
                  <Match when={step === "connect"}>
                    <ConnectStep />
                  </Match>
                  <Match when={step === "model"}>
                    <Show when={finished()} fallback={<ModelStep />}>
                      <DoneStep />
                    </Show>
                  </Match>
                </Switch>
              )}
            </Show>
          </div>
          <Show when={!finished() ? art() : null} keyed>
            {(current) => (
              <div class="ob-right" aria-hidden="true">
                <Illustration name={current.name} />
                <span class="ob-caption">{current.caption}</span>
              </div>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
