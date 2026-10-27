import { Link, useLocation } from "@tanstack/solid-router"
import type { Glyph } from "@kiko/ui/icons"
import { DashboardIcon, FolderIcon, LeafIcon, PlusIcon, SearchIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { type Component, For, type JSX, Show } from "solid-js"
import { displayShortcut } from "../commands/hotkeys"
import { type CommandId, findCommand, runCommand, shortcutOf } from "../commands/registry"

const hintOf = (id: CommandId): string => {
  const command = findCommand(id)
  const key = command ? shortcutOf(command) : undefined
  return key ? displayShortcut(key) : ""
}

function NavBody(props: { icon: Glyph; label: string; hint?: string }): JSX.Element {
  return (
    <>
      <span class="nav-icon">
        <RemixIcon icon={props.icon} size={16} />
      </span>
      <span class="nav-label">{props.label}</span>
      <Show when={props.hint}>
        <kbd class="nav-kbd" aria-hidden="true">
          {props.hint}
        </kbd>
      </Show>
    </>
  )
}

const LINKS: readonly { to: "/files" | "/recipes" | "/customize"; label: string; icon: Glyph; component: string }[] = [
  { to: "/files", label: "Files", icon: FolderIcon, component: "sidebar-files" },
  { to: "/recipes", label: "Recipes", icon: LeafIcon, component: "sidebar-recipes" },
  { to: "/customize", label: "Customize", icon: DashboardIcon, component: "sidebar-customize" },
]

export const SidebarNav: Component = () => {
  const pathname = useLocation({ select: (location) => location.pathname })
  const on = (to: string) => pathname().startsWith(to)
  return (
    <nav class="sidebar-nav" data-component="sidebar-nav" aria-label="Main">
      <button
        type="button"
        class="nav-row"
        data-component="sidebar-add"
        data-hint="chat.new"
        onClick={() => runCommand("chat.new")}
      >
        <NavBody icon={PlusIcon} label="New chat" hint={hintOf("chat.new")} />
      </button>
      <button
        type="button"
        class="nav-row"
        data-component="sidebar-search"
        data-hint="palette.open"
        data-hint-label="Search"
        onClick={() => runCommand("palette.open")}
      >
        <NavBody icon={SearchIcon} label="Search" hint={hintOf("palette.open")} />
      </button>
      <For each={LINKS}>
        {(link) => (
          <Link
            to={link.to}
            class="nav-row"
            data-component={link.component}
            data-active={on(link.to) ? "" : undefined}
            aria-current={on(link.to) ? "page" : undefined}
          >
            <NavBody icon={link.icon} label={link.label} />
          </Link>
        )}
      </For>
    </nav>
  )
}
