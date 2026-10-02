import { Navigate, type RouteDefinition } from "@solidjs/router"
import { lazy } from "solid-js"

/*
 * The route table. One lazy route per rail item, so each section's code loads
 * on intent (architecture 19.3). The array paths are the product document's
 * route list. The shell is the router's `root`, so it stays mounted across
 * every route change and only the main panel's content swaps.
 */
export const routes: RouteDefinition[] = [
  { path: "/", component: () => <Navigate href="/chat" /> },
  { path: ["/chat", "/chat/new", "/chat/:id"], component: lazy(() => import("./routes/chat")) },
  { path: ["/files", "/files/:chatId/*path"], component: lazy(() => import("./routes/files")) },
  { path: ["/board", "/board/:chatId"], component: lazy(() => import("./routes/board")) },
  { path: ["/memory", "/memory/:id"], component: lazy(() => import("./routes/memory")) },
  { path: "/settings/*", component: lazy(() => import("./routes/settings")) },
  { path: "*", component: () => <Navigate href="/chat" /> },
]
