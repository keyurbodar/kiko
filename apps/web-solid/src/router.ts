import { createRouter } from "@tanstack/solid-router"
import { Broken } from "./app/broken"
import { history } from "./app/history"
import { routeTree } from "./routeTree.gen"

export const router = createRouter({
  routeTree,
  history,
  defaultPreload: "intent",
  defaultErrorComponent: Broken,
})

declare module "@tanstack/solid-router" {
  interface Register {
    router: typeof router
  }
}
