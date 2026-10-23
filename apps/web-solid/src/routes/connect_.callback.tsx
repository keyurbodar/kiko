import { createFileRoute } from "@tanstack/solid-router"
import ConnectPage from "../app/connect"

export const Route = createFileRoute("/connect_/callback")({ component: ConnectPage })
