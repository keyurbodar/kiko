import { createBrowserHistory } from "@tanstack/solid-router"

export const history = createBrowserHistory()

export function openChat(roomId: string | null, options: { replace?: boolean } = {}): void {
  const path = roomId ? `/chat/${encodeURIComponent(roomId)}` : "/chat"
  if (options.replace) history.replace(path)
  else history.push(path)
}
