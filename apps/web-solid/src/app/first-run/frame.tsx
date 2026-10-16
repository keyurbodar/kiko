import { For, Match, Switch } from "solid-js"
import "./first-run.css"
import { ConnectStep } from "./connect-step"
import { ModelStep } from "./model-step"
import { currentStep } from "./progress"
import { positionOf, SHOWN } from "./steps"
import { Welcome } from "./welcome"

/*
 * First run: sign in with the access code, connect a model provider, pick Kiko's model. One screen
 * whose step swaps in place, so the bar and the background hold still while the step fades up. The
 * step comes from `currentStep` (progress.ts), so this view holds no state of its own.
 */
export default function FirstRun() {
  const at = () => positionOf(currentStep())
  return (
    <div class="h-dvh overflow-y-auto bg-background px-4 py-8" data-component="first-run" data-step={currentStep()}>
      <div class="mx-auto flex min-h-full w-full max-w-80 flex-col items-center justify-center gap-8">
        <div class="flex w-full gap-1.5" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax={SHOWN.length} aria-valuenow={at()} aria-valuetext={`Step ${at()} of ${SHOWN.length}`}>
          <For each={SHOWN}>
            {(_, i) => (
              <span class="first-run-bar h-1 flex-1 overflow-hidden rounded-full bg-control">
                <i class="block h-full rounded-full bg-foreground" attr:data-on={i() < at() ? "" : undefined} />
              </span>
            )}
          </For>
        </div>
        <Switch>
          <Match when={currentStep() === "welcome"}>
            <Welcome />
          </Match>
          <Match when={currentStep() === "connect"}>
            <ConnectStep />
          </Match>
          <Match when={currentStep() === "model"}>
            <ModelStep />
          </Match>
        </Switch>
      </div>
    </div>
  )
}
