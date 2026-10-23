import { createFileRoute, redirect } from "@tanstack/solid-router"

export const Route = createFileRoute("/_chat/")({
  beforeLoad: () => {
    throw redirect({ to: "/chat", replace: true })
  },
})
