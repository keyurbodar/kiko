import { createFileRoute } from "@tanstack/solid-router"
import KeyboardPage from "../settings/keyboard"

export const Route = createFileRoute("/_chat/settings/keyboard")({ component: KeyboardPage })
