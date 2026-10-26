import { createFileRoute, redirect } from "@tanstack/solid-router"
import { room } from "../state/room"

export const Route = createFileRoute("/_chat/chat/")({
  beforeLoad: () => {
    const roomId = room.resumeChat()
    if (roomId) throw redirect({ to: "/chat/$roomId", params: { roomId }, replace: true })
  },
})
