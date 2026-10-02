import { A, useLocation } from "@solidjs/router"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { For } from "solid-js"
import { RailIcon, SettingsIcon, SidebarPanelIcon } from "../sidebar/icons"
import { SECTIONS, sectionOf, type SectionId } from "./sections"

/*
 * The rail. Every item is a link, so the browser owns navigation and history,
 * and the active item is read from the URL. There is no tab signal here.
 *
 * The panel icon at the top is the one control that toggles the sidebar
 * column (`cmd+b` is the other). The shell owns the state and passes it in.
 * Pressing the active section is a plain navigation to where it already is.
 */
export function Rail(props: { collapsed: boolean; onToggleSidebar: () => void }) {
  const location = useLocation()
  const active = () => sectionOf(location.pathname)

  const item = (id: SectionId, label: string, href: string) => (
    <TooltipV2 placement="right" openDelay={400} value={label}>
      <A
        href={href}
        class="rail-tab"
        data-component="sidebar-rail-tab"
        data-panel={id}
        data-active={active() === id ? "" : undefined}
        aria-label={label}
        aria-current={active() === id ? "page" : undefined}
      >
        {id === "settings" ? (
          <SettingsIcon active={active() === id} />
        ) : (
          <RailIcon panel={id} active={active() === id} />
        )}
      </A>
    </TooltipV2>
  )

  return (
    <nav class="rail" aria-label="navigation" data-component="sidebar-rail">
      <TooltipV2 placement="right" openDelay={400} value="toggle sidebar">
        <button
          type="button"
          class="rail-tab"
          data-component="sidebar-toggle"
          aria-label="toggle sidebar"
          aria-expanded={!props.collapsed}
          aria-keyshortcuts="Control+B Meta+B"
          onClick={() => props.onToggleSidebar()}
        >
          <SidebarPanelIcon open={!props.collapsed} />
        </button>
      </TooltipV2>
      <For each={SECTIONS.filter((section) => section.id !== "settings")}>
        {(section) => item(section.id, section.label, section.href)}
      </For>
      <div class="rail-spacer" />
      {item("settings", "settings", "/settings")}
    </nav>
  )
}
