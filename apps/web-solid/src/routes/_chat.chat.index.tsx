import { createFileRoute, redirect } from "@tanstack/solid-router"
import { useApp } from "../lib/store"

export const Route = createFileRoute("/_chat/chat/")({
  beforeLoad: () => {
    const roomId = useApp.resumeChat()
    if (roomId) throw redirect({ to: "/chat/$roomId", params: { roomId }, replace: true })
  },
})
