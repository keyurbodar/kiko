import { useLocation, useNavigate } from "@solidjs/router"
import { For, Match, Show, Switch, createEffect, onCleanup, lazy } from "solid-js"
import "./first-run.css"
import { KikoMark, KikoWordmark } from "../../lib/brand"
import { hosted } from "../hosted"
import { backendConnectionNotice, session } from "../session"
import { Backdrop } from "./backdrop"
import { ClerkStep, resumeClerk } from "./clerk-step"
import { ConnectStep } from "./connect-step"
import { currentStep, useDifferentSignIn } from "./progress"
import { indexOf, stepsFor } from "./steps"
import { AccessCode } from "./welcome"

const STEPS = stepsFor(hosted)
const ConnectCloudflare = lazy(() => import("../connect").then((m) => ({ default: m.ConnectCloudflare })))

export default function FirstRun() {
  const location = useLocation()
  const navigate = useNavigate()
  const at = () => indexOf(currentStep(), hosted)

  if (hosted) void ConnectCloudflare.preload()
  if (hosted && session().status !== "signed-in" && currentStep() !== "cloudflare") onCleanup(resumeClerk(location.search))

  createEffect(() => {
    const path = location.pathname
    if (path !== "/welcome" && path !== "/connect/callback") navigate("/welcome", { replace: true })
  })

  return (
    <div class="welcome h-dvh" data-component="first-run" data-step={currentStep()}>
      <Backdrop />
      <div class="welcome-brand" role="img" aria-label="Kiko">
        <KikoMark class="welcome-brand-mark" />
        <KikoWordmark class="welcome-brand-wordmark" />
      </div>
      <div class="welcome-stage">
        <Show when={at() >= 0}>
          <ol class="welcome-steps" aria-label="Setup progress">
            <For each={STEPS}>
              {(s, i) => (
                <li data-state={i() < at() ? "done" : i() === at() ? "current" : "next"} aria-current={i() === at() ? "step" : undefined}>
                  <span class="welcome-step-star" aria-hidden="true" />
                  <span class="welcome-step-label">{s.label}</span>
                </li>
              )}
            </For>
          </ol>
        </Show>
        <div class="welcome-card">
          <Show when={currentStep()} keyed>
            {(step) => (
              <Switch>
                <Match when={step === "sign-in"}>{hosted ? <ClerkStep /> : <AccessCode />}</Match>
                <Match when={step === "cloudflare"}>
                  <Show when={backendConnectionNotice()}>
                    <div class="mb-3 flex flex-col gap-2">
                      <p class="text-sm text-muted-foreground" role="status">{backendConnectionNotice()}</p>
                      <button type="button" class="text-sm underline" onClick={() => void useDifferentSignIn()}>Use a different sign-in</button>
                    </div>
                  </Show>
                  <ConnectCloudflare />
                </Match>
                <Match when={step === "connect"}>
                  <ConnectStep />
                </Match>
              </Switch>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
