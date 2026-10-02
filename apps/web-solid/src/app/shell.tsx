import { useLocation } from "@solidjs/router"
import { createSignal, type ParentProps } from "solid-js"
import { Sidebar } from "../sidebar"
import { Rail } from "./rail"
import { sectionOf } from "./sections"
import { TopBar } from "./top-bar"

/*
 * The kat frame around every screen: rail, sidebar column, then the main panel
 * with its 32 px top-left corner and the top bar. The shell is the router's
 * root, so it never remounts on a route change and the swap is instant.
 *
 * `sidebar-shell` is the flex row the sidebar's stylesheet is scoped under.
 */
export function Shell(props: ParentProps) {
  const location = useLocation()
  const [collapsed, setCollapsed] = createSignal(false)
  return (
    <div
      class="sidebar-shell flex h-dvh overflow-hidden bg-[var(--bg-sidebar)]"
      data-component="app-shell"
      data-section={sectionOf(location.pathname) ?? undefined}
    >
      <Rail onActiveClick={() => setCollapsed((value) => !value)} />
      <Sidebar
        section={sectionOf(location.pathname)}
        collapsed={collapsed()}
        onCollapsedChange={setCollapsed}
      />
      <main
        class="flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-[32px] bg-bg"
        data-component="main-panel"
      >
        <TopBar />
        {props.children}
      </main>
    </div>
  )
}
