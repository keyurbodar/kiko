import { RouterProvider } from "@tanstack/solid-router"
import { render } from "solid-js/web"
import { currentStep } from "./app/first-run/progress"
import { FirstRun } from "./app/first-run/lazy"
import { bootstrapSession, session } from "./app/session"
import "./index.css"
import { router } from "./router"
import { whenIdle } from "./lib/idle"
import { loadOverlaysV2 } from "@kiko/ui/v2/overlays"
import { applyCommitted } from "@kiko/theme/apply"
import { DEFAULT_LOOK } from "@kiko/theme/look"

export async function start(): Promise<void> {
  if (currentStep() !== "done") await FirstRun.preload()
  if (session().status !== "signed-in") applyCommitted(DEFAULT_LOOK, false)
  const root = document.getElementById("root")
  if (!root) throw new Error("Root element #root not found")
  void bootstrapSession()
  root.replaceChildren()
  render(() => <RouterProvider router={router} />, root)
  void loadOverlaysV2().catch(() => {})
  whenIdle(preload)
}

function preload(): void {
  void loadOverlaysV2()
}
