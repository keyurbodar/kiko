import { createRootRoute, Outlet, useLocation, useRouter } from "@tanstack/solid-router"
import { applyCommitted } from "@kiko/theme/apply"
import { DEFAULT_LOOK } from "@kiko/theme/look"
import { createEffect, ErrorBoundary, Match, on, Switch } from "solid-js"
import { Broken } from "../app/broken"
import { FirstRun } from "../app/first-run/lazy"
import { currentStep } from "../app/first-run/progress"
import { roomForRoute } from "../app/sections"
import { rejected, session } from "../app/session"
import { Shell } from "../app/shell"
import { connection } from "../state/connection"
import { room } from "../state/room"
import { RuntimeProvider } from "../state/runtime"

function RootLayout() {
  const location = useLocation()
  const router = useRouter()
  room.followRoute((previous) => roomForRoute(previous, location().pathname, location().search))
  createEffect(() => {
    const s = session()
    if (s.status === "signed-in") {
      const id = s.user.id
      setTimeout(() => void import("../theme/live").then((m) => m.startTheme(id)), 0)
      setTimeout(() => void import("../settings/timezone").then((m) => m.syncTimeZone()), 2000)
    } else if (s.status === "signed-out") {
      applyCommitted(DEFAULT_LOOK, false)
      void import("../theme/live").then((m) => m.forgetTheme())
    }
  })
  createEffect(
    on(connection.view, (view) => {
      if (view === "signed-out" && session().status === "signed-in") void rejected()
    }),
  )
  return (
    <RuntimeProvider>
      <ErrorBoundary
        fallback={(error, reset) => (
          <Broken
            error={error}
            reset={() => {
              void router.invalidate()
              reset()
            }}
          />
        )}
      >
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
    </RuntimeProvider>
  )
}

export const Route = createRootRoute({ component: RootLayout })
