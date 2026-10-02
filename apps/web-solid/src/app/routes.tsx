import { Navigate, type RouteDefinition } from "@solidjs/router"
import { lazy } from "solid-js"
import { sectionOf } from "./sections"

/*
 * The route table. One lazy route per rail item, so each section's code loads
 * on intent (architecture 19.3). The array paths are the product document's
 * route list. The shell is the router's `root`, so it stays mounted across
 * every route change and only the main panel's content swaps.
 */
const pages = {
  chat: lazy(() => import("./routes/chat")),
  files: lazy(() => import("./routes/files")),
  board: lazy(() => import("./routes/board")),
  memory: lazy(() => import("./routes/memory")),
  settings: lazy(() => import("./routes/settings")),
}

/** Starts fetching a section's chunk on intent. Safe to repeat: `lazy` loads once. */
export function preloadRoute(href: string): void {
  const id = sectionOf(href)
  if (id) void pages[id].preload()
}

export const routes: RouteDefinition[] = [
  { path: "/", component: () => <Navigate href="/chat" /> },
  { path: ["/chat", "/chat/new", "/chat/:id"], component: pages.chat },
  { path: ["/files", "/files/:chatId/*path"], component: pages.files },
  { path: ["/board", "/board/:chatId"], component: pages.board },
  { path: ["/memory", "/memory/:id"], component: pages.memory },
  { path: "/settings/*", component: pages.settings },
  { path: "*", component: () => <Navigate href="/chat" /> },
]
