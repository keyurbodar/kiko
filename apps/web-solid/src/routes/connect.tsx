import { createFileRoute } from "@tanstack/solid-router"
import ConnectPage from "../app/connect"

export const Route = createFileRoute("/connect")({
  validateSearch: (search: Record<string, unknown>): { reconnect?: 1 } =>
    search.reconnect === 1 || search.reconnect === "1" ? { reconnect: 1 } : {},
  component: ConnectPage,
})
