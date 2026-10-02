import { A, useLocation } from "@solidjs/router"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { For } from "solid-js"
import { RailIcon, SettingsIcon } from "../sidebar/icons"
import { SECTIONS, sectionOf, type SectionId } from "./sections"

/*
 * The rail. Every item is a link, so the browser owns navigation and history,
 * and the active item is read from the URL. There is no tab signal here.
 *
 * Pressing the item that is already active toggles the sidebar column, which
 * is kat's iconbar behaviour; the shell owns that state and passes the toggle.
 */
export function Rail(props: { onActiveClick: () => void }) {
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
        onClick={(event) => {
          if (active() !== id) return
          event.preventDefault()
          props.onActiveClick()
        }}
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
      <For each={SECTIONS.filter((section) => section.id !== "settings")}>
        {(section) => item(section.id, section.label, section.href)}
      </For>
      <div class="rail-spacer" />
      {item("settings", "settings", "/settings")}
    </nav>
  )
}
