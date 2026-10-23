import { createFileRoute } from "@tanstack/solid-router"
import Appearance from "../theme/appearance"

export const Route = createFileRoute("/_chat/settings/appearance")({ component: Appearance })
