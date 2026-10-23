import { createFileRoute } from "@tanstack/solid-router"
import { ModelsPage } from "../settings/models"

export const Route = createFileRoute("/_chat/settings/models")({ component: ModelsPage })
