import { useLocation, useNavigate } from "@solidjs/router"
import { For, Match, Show, Switch, createEffect, onCleanup, lazy } from "solid-js"
import "./first-run.css"
import { hosted } from "../hosted"
import { backendConnectionNotice, session } from "../session"
import { Backdrop, Mascot } from "./backdrop"
import { ClerkStep, resumeClerk } from "./clerk-step"
import { ConnectStep } from "./connect-step"
import { currentStep, useDifferentSignIn } from "./progress"
import { indexOf, stepsFor } from "./steps"
import { AccessCode } from "./welcome"

const STEPS = stepsFor(hosted)
const ConnectCloudflare = lazy(() => import("../connect").then((m) => ({ default: m.ConnectCloudflare })))

const Check = () => (
  <svg viewBox="0 0 16 16" class="size-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
)

/*
 * `/welcome`: everything before the app, as one card floating on the bokeh sky. The mark and the sky
 * hold still while the step inside the card swaps and fades up. The step comes from `currentStep`
 * (progress.ts), so this view holds no state of its own. `/connect/callback` keeps its path until the
 * install answers, because Cloudflare redirects there.
 */
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
      <div class="welcome-stage">
        <Mascot />
        <Show when={at() >= 0}>
          <ol class="welcome-steps" aria-label="Setup progress">
            <For each={STEPS}>
              {(s, i) => (
                <li data-state={i() < at() ? "done" : i() === at() ? "current" : "next"} aria-current={i() === at() ? "step" : undefined}>
                  <span class="welcome-pill">
                    <Show when={i() < at()} fallback={<span class="welcome-pill-number">{i() + 1}</span>}>
                      <Check />
                    </Show>
                    <span class={i() === at() ? "welcome-pill-label" : "sr-only"}>{s.label}</span>
                  </span>
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
