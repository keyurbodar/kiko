import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router"
import { SettingsDialog } from "../settings/settings-dialog"

function SettingsLayout() {
  return (
    <SettingsDialog>
      <Outlet />
    </SettingsDialog>
  )
}

export const Route = createFileRoute("/_chat/settings")({
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/$/, "") === "/settings") throw redirect({ to: "/settings/models", replace: true })
  },
  pendingComponent: () => null,
  component: SettingsLayout,
})
