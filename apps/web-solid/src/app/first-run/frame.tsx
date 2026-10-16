import { useLocation, useNavigate } from "@solidjs/router"
import { For, Match, Show, Switch, createEffect, lazy } from "solid-js"
import "./first-run.css"
import { hosted } from "../hosted"
import { session } from "../session"
import { Backdrop, Mascot } from "./backdrop"
import { ClerkStep, resumeClerk } from "./clerk-step"
import { ConnectStep } from "./connect-step"
import { ModelStep } from "./model-step"
import { currentStep, working } from "./progress"
import { indexOf, stepsFor } from "./steps"
import { AccessCode, Welcome } from "./welcome"

const STEPS = stepsFor(hosted)
const ConnectCloudflare = lazy(() => import("../connect").then((m) => ({ default: m.ConnectCloudflare })))

const Check = () => (
  <svg viewBox="0 0 16 16" class="size-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
)

/*
 * `/welcome`: everything before the app, as one screen in t3code's WelcomeWizard shape. The mascot and its
 * backdrop hold still while the step under them swaps and fades up. The step comes from `currentStep`
 * (progress.ts), so this view holds no state of its own. `/connect/callback` keeps its path until the
 * install answers, because Cloudflare redirects there.
 */
export default function FirstRun() {
  const location = useLocation()
  const navigate = useNavigate()
  const at = () => indexOf(currentStep(), hosted)

  if (hosted) void ConnectCloudflare.preload()
  if (hosted && session().status !== "signed-in" && currentStep() !== "cloudflare") resumeClerk(location.search)

  createEffect(() => {
    const path = location.pathname
    if (path !== "/welcome" && path !== "/connect/callback") navigate("/welcome", { replace: true })
  })

  return (
    <div class="welcome h-dvh overflow-y-auto bg-background" data-component="first-run" data-step={currentStep()}>
      <div class="relative min-h-full">
        <Backdrop busy={working()} />
        <div class="relative flex flex-col items-center px-4 pb-12 pt-[var(--welcome-top)]">
          <Mascot />
          <div class={`flex w-full max-w-[400px] flex-col gap-3 ${currentStep() === "welcome" ? "mt-24" : "mt-16"}`}>
            <Show when={at() >= 0}>
              <ol class="welcome-steps welcome-step flex items-center justify-center gap-4" aria-label="Setup progress">
                <For each={STEPS}>
                  {(s, i) => (
                    <li class="flex items-center gap-2" aria-current={i() === at() ? "step" : undefined}>
                      <span
                        class="grid size-5 shrink-0 place-items-center rounded-full text-xs font-medium tabular-nums"
                        data-state={i() < at() ? "done" : i() === at() ? "current" : "next"}
                      >
                        {i() < at() ? <Check /> : i() + 1}
                      </span>
                      <span class={`text-sm font-medium ${i() === at() ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
            <Show when={currentStep()} keyed>
              {(step) => (
                <div class={step === "welcome" ? "" : "welcome-panel rounded-2xl px-6 py-6"}>
                  <Switch>
                    <Match when={step === "welcome"}>
                      <Welcome />
                    </Match>
                    <Match when={step === "sign-in"}>{hosted ? <ClerkStep /> : <AccessCode />}</Match>
                    <Match when={step === "cloudflare"}>
                      <ConnectCloudflare />
                    </Match>
                    <Match when={step === "connect"}>
                      <ConnectStep />
                    </Match>
                    <Match when={step === "model"}>
                      <ModelStep />
                    </Match>
                  </Switch>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
