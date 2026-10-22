import { useLocation, useNavigate } from "@solidjs/router"
import { For, Match, Show, Switch, createEffect, lazy } from "solid-js"
import "./first-run.css"
import { KikoMark, KikoWordmark } from "../../lib/brand"
import { hosted } from "../hosted"
import { backendConnectionNotice } from "../session"
import { Backdrop } from "./backdrop"
import { ClerkStep } from "./clerk-step"
import { ConnectStep } from "./connect-step"
import { ModelStep } from "./model-step"
import { currentStep, useDifferentSignIn, working } from "./progress"
import { indexOf, stepsFor } from "./steps"
import { AccessCode } from "./welcome"

const STEPS = stepsFor(hosted)
const ConnectCloudflare = lazy(() => import("../connect").then((m) => ({ default: m.ConnectCloudflare })))

export default function FirstRun() {
  const location = useLocation()
  const navigate = useNavigate()
  const at = () => indexOf(currentStep(), hosted)

  if (hosted) void ConnectCloudflare.preload()

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
        <div class="welcome-card" data-fill={currentStep() === "model" ? "" : undefined}>
          <Show when={currentStep()} keyed>
            {(step) => (
              <Switch>
                <Match when={step === "sign-in"}>{hosted ? <ClerkStep /> : <AccessCode />}</Match>
                <Match when={step === "cloudflare"}>
                  <Show when={backendConnectionNotice()}>
                    <div class="mb-3 flex flex-col gap-2">
                      <p class="text-sm text-muted-foreground" role="status">{backendConnectionNotice()}</p>
                    </div>
                  </Show>
                  <ConnectCloudflare />
                </Match>
                <Match when={step === "connect"}>
                  <ConnectStep />
                </Match>
                <Match when={step === "model"}>
                  <ModelStep />
                </Match>
              </Switch>
            )}
          </Show>
          <Show when={currentStep() === "cloudflare" || currentStep() === "connect"}>
            <div class="welcome-foot mt-3">
              <button
                type="button"
                data-action="restart-onboarding"
                disabled={working()}
                class="disabled:cursor-default disabled:opacity-50"
                onClick={() => {
                  navigate("/welcome", { replace: true })
                  void useDifferentSignIn()
                }}
              >
                Sign out and restart
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
