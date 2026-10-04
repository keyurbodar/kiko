import { A, useLocation } from "@solidjs/router"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { For, Show } from "solid-js"
import { useApp } from "../lib/store"
import { RailIcon, SettingsIcon, SidebarPanelIcon } from "../sidebar/icons"
import { intentRef } from "../lib/intent"
import { preloadRoute } from "./routes"
import { SECTIONS, sectionOf, type SectionId } from "./sections"

/*
 * The rail. Every item is a link, so the browser owns navigation and history,
 * and the active item is read from the URL. There is no tab signal here.
 *
 * The panel icon at the top is the one control that toggles the sidebar
 * column (`cmd+s` is the other). The shell owns the state and passes it in.
 * Pressing the active section is a plain navigation to where it already is.
 */
export function Rail(props: { collapsed: boolean; onToggleSidebar: () => void }) {
  const location = useLocation()
  const active = () => sectionOf(location.pathname)
  const waiting = () => (useApp.user()?.proposals().length ?? 0) > 0

  const item = (id: SectionId, label: string, to: string | (() => string)) => {
    const href = () => (typeof to === "function" ? to() : to)
    return (
    <TooltipV2 placement="right" openDelay={400} value={label}>
      <A
        href={href()}
        class="rail-tab"
        ref={intentRef(() => preloadRoute(href()))}
        data-component="sidebar-rail-tab"
        data-panel={id}
        data-hint={id === "settings" ? "settings.open" : "go.chat"}
        data-hint-label={id === "settings" ? "settings" : "chats"}
        data-hint-side="right"
        data-active={active() === id ? "" : undefined}
        aria-label={id === "settings" && waiting() ? `${label}, an extension waits for review` : label}
        style={id === "settings" ? { position: "relative" } : undefined}
        aria-current={active() === id ? "page" : undefined}
      >
        {id === "settings" ? (
          <>
            <SettingsIcon active={active() === id} />
            {/* An extension install waits for the human (architecture section 24): a dot, and the link goes to its review. */}
            <Show when={waiting()}>
              <span class="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full bg-[var(--accent)]" data-component="rail-extensions-waiting" aria-hidden="true" />
            </Show>
          </>
        ) : (
          <RailIcon panel={id} active={active() === id} />
        )}
      </A>
    </TooltipV2>
    )
  }

  return (
    <nav class="rail" aria-label="navigation" data-component="sidebar-rail">
      <TooltipV2 placement="right" openDelay={400} value="toggle sidebar">
        <button
          type="button"
          class="rail-tab"
          data-component="sidebar-toggle"
          aria-label="toggle sidebar"
          data-hint="view.toggle-sidebar"
          data-hint-side="right"
          aria-expanded={!props.collapsed}
          aria-keyshortcuts="Control+S Meta+S"
          onClick={() => props.onToggleSidebar()}
        >
          <SidebarPanelIcon open={!props.collapsed} />
        </button>
      </TooltipV2>
      <For each={SECTIONS.filter((section) => section.id !== "settings")}>
        {(section) => item(section.id, section.label, section.href)}
      </For>
      <div class="rail-spacer" />
      {item("settings", "settings", () => (waiting() ? "/settings/extensions" : "/settings"))}
    </nav>
  )
}
