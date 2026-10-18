import { useLocation, useNavigate } from "@solidjs/router"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon } from "@kiko/ui/icons"
import { For, Match, Show, Switch, createEffect, lazy } from "solid-js"
import "./first-run.css"
import { hosted } from "../hosted"
import { session } from "../session"
import { KikoWordmark } from "../../lib/brand"
import { Backdrop, Mascot } from "./backdrop"
import { ClerkStep, resumeClerk } from "./clerk-step"
import { ConnectStep } from "./connect-step"
import { ModelStep } from "./model-step"
import { currentStep, working } from "./progress"
import { indexOf, stepsFor } from "./steps"
import { AccessCode, Welcome } from "./welcome"

const STEPS = stepsFor(hosted)
const ConnectCloudflare = lazy(() => import("../connect").then((m) => ({ default: m.ConnectCloudflare })))

const Check = () => <RemixIcon icon={CheckIcon} class="size-3" />

/*
 * `/welcome`: everything before the app, as one card on a mural of Kiko, after Cal.com's sign-in.
 * Kiko's logo sits in a band at the card's head and the setup's steps in a band at its foot, and the
 * step swaps and fades up between them. The step comes from `currentStep` (progress.ts), so this view holds no state of its own.
 * `/connect/callback` keeps its path until the install answers, because Cloudflare redirects there.
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
      <div class="welcome-page">
        <Backdrop />
        <div class="welcome-card" data-busy={working() ? "" : undefined}>
          <header class="welcome-head">
            <Mascot />
            <KikoWordmark class="welcome-wordmark" />
          </header>
          <div class="welcome-card-body">
            <Show when={currentStep()} keyed>
              {(step) => (
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
              )}
            </Show>
          </div>
          <Show when={at() >= 0}>
            <ol class="welcome-steps" aria-label="Setup progress">
              <For each={STEPS}>
                {(s, i) => (
                  <li data-state={i() < at() ? "done" : i() === at() ? "current" : "next"} aria-current={i() === at() ? "step" : undefined}>
                    <span class="welcome-step-mark">{i() < at() ? <Check /> : i() + 1}</span>
                    <span>{s.label}</span>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </div>
      </div>
    </div>
  )
}
