import { createFileRoute, Outlet } from "@tanstack/solid-router"
import { ChatView } from "../app/chat-view"

function ChatLayout() {
  return (
    <>
      <ChatView />
      <Outlet />
    </>
  )
}

export const Route = createFileRoute("/_chat")({ component: ChatLayout })
