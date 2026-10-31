import { Link, useLocation } from "@tanstack/solid-router"
import {
  DashboardIcon,
  FolderIcon,
  type Glyph,
  HelpIcon,
  LeafIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SidebarLeftIcon,
} from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { For, type JSX } from "solid-js"
import { runCommand } from "../commands/registry"
import { isLive } from "../sidebar/chat-row"
import { SidebarToggle } from "../sidebar"
import { ChatAvatar, IdentityAvatar } from "../lib/IdentityAvatar"
import { inSettings, openSettings } from "../settings/open"
import { room } from "../state/room"
import { openChat } from "./history"
import { session } from "./session"

const ITEM =
  "grid size-control-lg shrink-0 place-items-center rounded-base icon-secondary transition-[background-color,color,transform] duration-(--duration-fast) ease-sharp hover:bg-quaternary active:scale-(--press-scale) data-active:bg-quaternary data-active:icon-primary"

const LINKS: readonly { to: "/files" | "/recipes" | "/customize"; label: string; icon: Glyph }[] = [
  { to: "/files", label: "Files", icon: FolderIcon },
  { to: "/recipes", label: "Recipes", icon: LeafIcon },
  { to: "/customize", label: "Customize", icon: DashboardIcon },
]

const MAX_FACES = 5

function Tip(props: { label: string; children: JSX.Element }) {
  return (
    <TooltipV2 placement="right" openDelay={300} value={props.label}>
      {props.children}
    </TooltipV2>
  )
}

export function Rail(props: { onExpand: () => void }) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const live = () => room.bots().filter(isLive).slice(0, MAX_FACES)
  const on = (to: string) => (pathname().startsWith(to) ? "" : undefined)
  const seed = () => {
    const s = session()
    return s.status === "signed-in" ? s.user.id : "you"
  }
  return (
    <nav
      class="flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden bg-chrome shadow-[inset_-1px_0_0_var(--stroke-tertiary)]"
      data-component="sidebar-rail"
      aria-label="Main"
    >
      <div class="flex h-full w-sidebar-width-collapsed shrink-0 flex-col items-center gap-[5px] pb-3">
        <div class="grid h-top-bar-height w-full shrink-0 place-items-center">
          <SidebarToggle open={false} onToggle={props.onExpand} class={`rail-toggle ${ITEM}`}>
            <img src="/kiko.svg" alt="" draggable={false} class="rail-logo" />
            <RemixIcon icon={SidebarLeftIcon} size={14} class="rail-toggle-icon" />
          </SidebarToggle>
        </div>
        <Tip label="New chat">
          <button type="button" class={ITEM} aria-label="New chat" onClick={() => runCommand("chat.new")}>
            <RemixIcon icon={PlusIcon} size={14} />
          </button>
        </Tip>
        <Tip label="Search">
          <button type="button" class={ITEM} aria-label="Search" onClick={() => runCommand("palette.open")}>
            <RemixIcon icon={SearchIcon} size={14} />
          </button>
        </Tip>
        <For each={LINKS}>
          {(link) => (
            <Tip label={link.label}>
              <Link
                to={link.to}
                class={ITEM}
                data-active={on(link.to)}
                aria-current={on(link.to) === undefined ? undefined : "page"}
                aria-label={link.label}
              >
                <RemixIcon icon={link.icon} size={14} />
              </Link>
            </Tip>
          )}
        </For>
        <div class="mt-3 flex flex-col items-center gap-[5px]" data-component="sidebar-rail-live">
          <For each={live()}>
            {(bot) => (
              <Tip label={`${bot.name}, ${bot.typing ?? "Thinking"}`}>
                <button type="button" class={ITEM} aria-label={bot.name} onClick={() => openChat(bot.id)}>
                  <ChatAvatar faces={room.chatFaces(bot.id)} size={20} />
                </button>
              </Tip>
            )}
          </For>
        </div>
        <div class="flex-1" />
        <Tip label="Keyboard shortcuts">
          <button type="button" class={ITEM} aria-label="Help and shortcuts" onClick={() => openSettings("keyboard")}>
            <RemixIcon icon={HelpIcon} size={14} />
          </button>
        </Tip>
        <Tip label="Settings">
          <button
            type="button"
            class={ITEM}
            aria-label="Settings"
            data-active={inSettings(pathname()) ? "" : undefined}
            onClick={() => runCommand("settings.open")}
          >
            <RemixIcon icon={SettingsIcon} size={14} />
          </button>
        </Tip>
        <Tip label="Account">
          <button type="button" class={ITEM} aria-label="Account" onClick={() => openSettings("account")}>
            <IdentityAvatar seed={seed()} size={20} class="overflow-hidden rounded-full" />
          </button>
        </Tip>
      </div>
    </nav>
  )
}
