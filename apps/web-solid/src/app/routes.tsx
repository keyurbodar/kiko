import { Navigate, type RouteDefinition, useParams } from "@solidjs/router"
import { lazy } from "solid-js"
import { useApp } from "../lib/store"
import { openInfo } from "../chat/info/state"
import { openTabs } from "./open-tabs"
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
  settings: lazy(() => import("./routes/settings")),
}

/** Starts fetching a section's chunk on intent. Safe to repeat: `lazy` loads once. */
export function preloadRoute(href: string): void {
  const id = sectionOf(href)
  if (id) void pages[id].preload()
}

/*
 * Memory is part of a chat now. `/memory` and `/memory/:id` open the active chat with the panel on
 * memory (and on the record, when the path names one). The active chat is the last one the reader
 * had open, else the first open tab, else the chat home.
 */
function MemoryRedirect() {
  const params = useParams<{ id?: string }>()
  const chat = useApp.activeThreadId() ?? openTabs.ids()[0] ?? null
  openInfo(params.id ? { kind: "record", id: params.id } : { kind: "memory" })
  return <Navigate href={chat ? `/chat/${chat}` : "/chat"} />
}

export const routes: RouteDefinition[] = [
  { path: "/", component: () => <Navigate href="/chat" /> },
  { path: ["/chat", "/chat/new", "/chat/:id"], component: pages.chat },
  { path: ["/files", "/files/:chatId/*path"], component: pages.files },
  { path: ["/board", "/board/:chatId"], component: () => <Navigate href="/chat" /> },
  { path: ["/memory", "/memory/:id"], component: MemoryRedirect },
  { path: "/settings/*", component: pages.settings },
  { path: "*", component: () => <Navigate href="/chat" /> },
]
