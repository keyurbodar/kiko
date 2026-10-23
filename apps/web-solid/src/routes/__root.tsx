import { createRootRoute, Outlet, useLocation } from "@tanstack/solid-router"
import { applyCommitted } from "@kiko/theme/apply"
import { DEFAULT_LOOK } from "@kiko/theme/look"
import { createEffect, ErrorBoundary, Match, Switch } from "solid-js"
import { Broken } from "../app/broken"
import { FirstRun } from "../app/first-run/lazy"
import { currentStep } from "../app/first-run/progress"
import { roomInUrl } from "../app/sections"
import { session } from "../app/session"
import { Shell } from "../app/shell"
import { useApp } from "../lib/store"

function RootLayout() {
  const location = useLocation()
  useApp.followRoute(() => roomInUrl(location().pathname, location().search))
  createEffect(() => {
    const s = session()
    if (s.status === "signed-in") {
      void useApp.start(s.user.id)
      const id = s.user.id
      setTimeout(() => void import("../theme/live").then((m) => m.startTheme(id)), 0)
      setTimeout(() => void import("../settings/timezone").then((m) => m.syncTimeZone()), 2000)
    } else if (s.status === "signed-out") {
      applyCommitted(DEFAULT_LOOK, false)
      useApp.stop()
      void import("../theme/live").then((m) => m.forgetTheme())
    }
  })
  return (
    <ErrorBoundary fallback={(error, reset) => <Broken error={error} reset={reset} />}>
      <Switch>
        <Match when={currentStep() !== "done"}>
          <FirstRun />
        </Match>
        <Match when={session().status === "signed-in"}>
          <Shell>
            <Outlet />
          </Shell>
        </Match>
      </Switch>
    </ErrorBoundary>
  )
}

export const Route = createRootRoute({ component: RootLayout })
