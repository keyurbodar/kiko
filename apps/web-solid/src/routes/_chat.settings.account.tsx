import { createFileRoute } from "@tanstack/solid-router"
import { Account } from "../settings/account"

export const Route = createFileRoute("/_chat/settings/account")({ component: Account })
