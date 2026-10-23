import { createRouter } from "@tanstack/solid-router"
import { Broken } from "./app/broken"
import { history } from "./app/history"
import { PageSkeleton } from "./app/page-skeleton"
import { routeTree } from "./routeTree.gen"

export const router = createRouter({
  routeTree,
  history,
  defaultPreload: "intent",
  defaultPendingMs: 0,
  defaultPendingComponent: PageSkeleton,
  defaultErrorComponent: Broken,
})

declare module "@tanstack/solid-router" {
  interface Register {
    router: typeof router
  }
}
