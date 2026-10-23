import { createFileRoute, redirect } from "@tanstack/solid-router"
import { landingSection } from "../settings/sections"

export const Route = createFileRoute("/_chat/settings/$")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: `/settings/${landingSection(params._splat?.split("/")[0])}`, replace: true })
  },
})
