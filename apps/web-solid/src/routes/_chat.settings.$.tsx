import { createFileRoute, redirect } from "@tanstack/solid-router"
import { landingSection } from "../settings/sections"

const narrow = () => typeof matchMedia === "function" && matchMedia("(width < 768px)").matches

export const Route = createFileRoute("/_chat/settings/$")({
  beforeLoad: ({ params }) => {
    const id = params._splat?.split("/")[0]
    if (!id && narrow()) return
    throw redirect({ to: `/settings/${landingSection(id)}`, replace: true })
  },
})
