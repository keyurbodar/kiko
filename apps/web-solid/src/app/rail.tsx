import { Link, useLocation } from "@tanstack/solid-router"
import { DashboardIcon, FolderIcon, type Glyph, LeafIcon, PlusIcon, SearchIcon, SettingsIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { For, type JSX } from "solid-js"
import { runCommand } from "../commands/registry"
import { isLive } from "../sidebar/chat-row"
import { SidebarToggle } from "../sidebar"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { room } from "../state/room"
import { openChat } from "./history"

const BUTTON =
  "grid size-9 shrink-0 place-items-center rounded-control text-[var(--text-200)] transition-[background-color,color,transform] duration-(--dur-hover) ease-kiko hover:bg-fill-hover hover:text-[var(--text-000)] active:scale-(--press-scale)"

const LINKS: readonly { to: "/files" | "/recipes" | "/customize"; label: string; icon: Glyph }[] = [
  { to: "/files", label: "Files", icon: FolderIcon },
  { to: "/recipes", label: "Recipes", icon: LeafIcon },
  { to: "/customize", label: "Customize", icon: DashboardIcon },
]

const MAX_FACES = 5

function Tip(props: { label: string; children: JSX.Element }) {
  return (
    <TooltipV2 placement="right" openDelay={500} value={props.label}>
      {props.children}
    </TooltipV2>
  )
}

export function Rail(props: { onExpand: () => void }) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const live = () => room.bots().filter(isLive).slice(0, MAX_FACES)
  return (
    <nav
      class="flex h-full w-14 shrink-0 flex-col items-center gap-1 bg-side pb-3"
      data-component="sidebar-rail"
      aria-label="Main"
    >
      <div class="grid h-14 w-full shrink-0 place-items-center">
        <SidebarToggle open={false} onToggle={props.onExpand} class={BUTTON} iconSize={20} />
      </div>
      <Tip label="New chat">
        <button type="button" class={BUTTON} aria-label="New chat" onClick={() => runCommand("chat.new")}>
          <RemixIcon icon={PlusIcon} size={20} />
        </button>
      </Tip>
      <Tip label="Search">
        <button type="button" class={BUTTON} aria-label="Search" onClick={() => runCommand("palette.open")}>
          <RemixIcon icon={SearchIcon} size={20} />
        </button>
      </Tip>
      <For each={LINKS}>
        {(link) => (
          <Tip label={link.label}>
            <Link
              to={link.to}
              class={`${BUTTON} ${pathname().startsWith(link.to) ? "bg-fill-selected text-[var(--text-000)]" : ""}`}
              aria-label={link.label}
            >
              <RemixIcon icon={link.icon} size={20} />
            </Link>
          </Tip>
        )}
      </For>
      <div class="mt-3 flex flex-col items-center gap-1.5" data-component="sidebar-rail-live">
        <For each={live()}>
          {(bot) => (
            <Tip label={`${bot.name}, ${bot.typing ?? "Thinking"}`}>
              <button
                type="button"
                class="grid size-9 place-items-center rounded-control transition-transform duration-(--dur-hover) ease-kiko hover:bg-fill-hover active:scale-(--press-scale)"
                aria-label={bot.name}
                onClick={() => openChat(bot.id)}
              >
                <ChatAvatar faces={room.chatFaces(bot.id)} size={28} />
              </button>
            </Tip>
          )}
        </For>
      </div>
      <div class="flex-1" />
      <Tip label="Settings">
        <button type="button" class={BUTTON} aria-label="Settings" onClick={() => runCommand("settings.open")}>
          <RemixIcon icon={SettingsIcon} size={20} />
        </button>
      </Tip>
    </nav>
  )
}
