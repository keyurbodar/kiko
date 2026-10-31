import { RouterProvider } from "@tanstack/solid-router"
import { render } from "solid-js/web"
import { currentStep } from "./app/first-run/progress"
import { FirstRun } from "./app/first-run/lazy"
import { session } from "./app/session"
import "./index.css"
import { router } from "./router"
import { applyCommitted } from "@kiko/theme/apply"
import { DEFAULT_LOOK } from "@kiko/theme/look"

function trackInput(): void {
  const mark = (input: "pointer" | "keyboard") => () => {
    if (document.documentElement.dataset.input !== input) document.documentElement.dataset.input = input
  }
  document.addEventListener("pointerdown", mark("pointer"), true)
  document.addEventListener("keydown", mark("keyboard"), true)
}

export async function start(): Promise<void> {
  trackInput()
  if (currentStep() !== "done") await FirstRun.preload()
  if (session().status !== "signed-in") applyCommitted(DEFAULT_LOOK, false)
  const root = document.getElementById("root")
  if (!root) throw new Error("Root element #root not found")
  root.replaceChildren()
  render(() => <RouterProvider router={router} />, root)
}
