import { createFileRoute } from "@tanstack/solid-router"
import InitiativePage from "../settings/initiative"

export const Route = createFileRoute("/_chat/settings/general")({ component: InitiativePage })
