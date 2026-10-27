import { Outlet, useLocation } from "@tanstack/solid-router"
import { ChatView } from "./chat-view"
import { coversChat } from "./sections"

const PAGE = "absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg"

export function ChatFrame() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const covered = () => coversChat(pathname())
  return (
    <div class="relative flex min-h-0 min-w-0 flex-1" data-component="chat-frame">
      <div
        class={`flex min-h-0 min-w-0 flex-1 flex-col ${covered() ? "invisible" : ""}`}
        data-component="chat-view"
        data-covered={covered() ? "" : undefined}
        inert={covered()}
      >
        <ChatView covered={covered()} />
      </div>
      <div class={covered() ? PAGE : "contents"} data-component="chat-page">
        <Outlet />
      </div>
    </div>
  )
}
