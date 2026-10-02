import { useLocation } from "@solidjs/router"
import { Show } from "solid-js"
import { sectionOf } from "./sections"

/*
 * The 50 px bar over the main panel. It names the section and nothing else:
 * kat's terminal, browser, notification and share controls are left out. The
 * chat route fills the same bar with its tab strip later.
 */
export function TopBar() {
  const location = useLocation()
  const section = () => sectionOf(location.pathname)
  return (
    <header
      class="flex h-[50px] shrink-0 items-center px-4 text-sm font-medium text-muted"
      data-component="top-bar"
    >
      <Show when={section()}>{(id) => <span data-component="top-bar-title">{id()}</span>}</Show>
    </header>
  )
}
