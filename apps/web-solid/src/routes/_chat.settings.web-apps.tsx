import { createFileRoute } from "@tanstack/solid-router"
import WebApps from "../settings/web-apps"

export const Route = createFileRoute("/_chat/settings/web-apps")({ component: WebApps })
