import { createFileRoute } from "@tanstack/solid-router"
import CustomizePage from "../customize/page"

export const Route = createFileRoute("/_chat/customize")({ component: CustomizePage })
