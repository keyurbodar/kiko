import { Link, useLocation } from "@tanstack/solid-router"
import { type JSX, Suspense } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { HelpIcon, SearchIcon, SettingsIcon, SidebarLeftIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { session } from "../app/session"
import { profile } from "../app/hosted"
import type { SectionId } from "../app/sections"
import { runCommand } from "../commands/registry"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { inSettings, openSettings } from "../settings/open"
import { ChatPanel } from "./chat-panel"
import { SidebarNav } from "./nav"
import "./sidebar.css"
import UpdatePill from "../app/update-pill"

export interface SidebarProps {
  section: SectionId | null
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar(props: SidebarProps) {
  const collapsed = () => props.collapsed

  return (
    <aside
      class="panel"
      data-component="sidebar"
      data-panel={props.section ?? undefined}
      data-collapsed={collapsed() ? "" : undefined}
    >
      <header class="panel-header">
        <Link to="/chat" class="panel-brand" data-component="sidebar-brand" aria-label="Chats">
          Kiko
        </Link>
        <span class="flex-1" aria-hidden="true" />
        <SidebarToggle open onToggle={props.onToggle} />
        <HeaderSearch />
      </header>

      <SidebarNav />

      <div class="panel-scroll">
        <div class="panel-slot" data-slot="chat">
          <ChatPanel />
        </div>
      </div>

      <Foot />
    </aside>
  )
}

function HeaderSearch() {
  return (
    <TooltipV2 placement="bottom" openDelay={500} value="Search">
      <button
        type="button"
        class="panel-icon-button"
        data-component="sidebar-header-search"
        aria-label="Search"
        onClick={() => runCommand("palette.open")}
      >
        <RemixIcon icon={SearchIcon} size={13} />
      </button>
    </TooltipV2>
  )
}

export function SidebarToggle(props: { open: boolean; onToggle: () => void; class?: string; children?: JSX.Element }) {
  return (
    <TooltipV2 placement="bottom" openDelay={500} value={props.open ? "Hide sidebar" : "Show sidebar"}>
      <button
        type="button"
        class={props.class ?? "panel-icon-button"}
        data-component="sidebar-toggle"
        aria-label="Toggle sidebar"
        aria-expanded={props.open}
        aria-keyshortcuts="Control+\ Meta+\"
        data-hint="view.toggle-sidebar"
        onClick={() => props.onToggle()}
      >
        {props.children ?? <RemixIcon icon={SidebarLeftIcon} size={13} />}
      </button>
    </TooltipV2>
  )
}

function Foot() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const onSettings = () => inSettings(pathname())
  const user = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  return (
    <>
      <Suspense>
        <UpdatePill />
      </Suspense>
      <footer class="panel-foot" data-component="sidebar-foot">
        <button
          type="button"
          class="panel-me cursor-pointer"
          data-component="sidebar-me"
          aria-label="Account"
          aria-haspopup="dialog"
          onClick={() => openSettings("account")}
        >
          <IdentityAvatar seed={user()?.id ?? "you"} size={20} class="panel-me-avatar" />
          <span class="panel-me-name">{profile()?.name ?? user()?.name ?? "You"}</span>
        </button>
        <TooltipV2 placement="top" openDelay={500} value="Keyboard shortcuts">
          <button
            type="button"
            class="panel-icon-button"
            data-component="sidebar-help"
            aria-label="Help and shortcuts"
            onClick={() => openSettings("keyboard")}
          >
            <RemixIcon icon={HelpIcon} size={13} />
          </button>
        </TooltipV2>
        <TooltipV2 placement="top" openDelay={500} value="Settings">
          <button
            type="button"
            class="panel-icon-button relative"
            data-component="sidebar-settings"
            data-hint="settings.open"
            data-hint-label="Settings"
            data-active={onSettings() ? "" : undefined}
            aria-haspopup="dialog"
            aria-expanded={onSettings()}
            aria-label="Settings"
            onClick={() => openSettings()}
          >
            <RemixIcon icon={SettingsIcon} size={13} />
          </button>
        </TooltipV2>
      </footer>
    </>
  )
}
