import { createFileRoute } from "@tanstack/solid-router"
import Computers from "../settings/computers"

export const Route = createFileRoute("/_chat/settings/computers")({ component: Computers })
