import { createFileRoute, Navigate, redirect } from "@tanstack/solid-router"
import { currentStep } from "../app/first-run/progress"

export const Route = createFileRoute("/welcome")({
  beforeLoad: () => {
    if (currentStep() === "done") throw redirect({ to: "/chat", replace: true })
  },
  component: () => <Navigate to="/chat" replace />,
})
