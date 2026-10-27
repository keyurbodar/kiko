import { createFileRoute } from "@tanstack/solid-router"
import { ChatFrame } from "../app/chat-frame"

export const Route = createFileRoute("/_chat")({ component: ChatFrame })
