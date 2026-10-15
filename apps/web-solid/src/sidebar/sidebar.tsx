import { A, useLocation, useNavigate } from "@solidjs/router"
import { type Component, createEffect, createSignal, For, lazy, Show, Suspense } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ComposeIcon, SettingsIcon, SidebarLeftIcon, SparklesIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { session } from "../app/session"
import { SECTIONS, type SectionId } from "../app/sections"
import { runCommand } from "../commands/registry"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { KIKO } from "@kiko/protocol"
import { ChatPanel } from "./chat-panel"
import "./sidebar.css"

/*
 * One panel per section, chosen from this table. Chat paints with the first frame; the others
 * load the first time their section opens, and then stay mounted so each keeps its scroll.
 */
const PANELS: Record<SectionId, Component> = {
  chat: ChatPanel,
  settings: lazy(() => import("./settings/sidebar")),
  recipes: lazy(() => import("./recipes/sidebar")),
}
const SECTION_IDS = SECTIONS.map((section) => section.id)

type PanelAction = {
  label: string
  run: (navigate: (to: string) => void) => void
}

/** The header's one primary action. Settings has none. */
const ACTIONS: Record<SectionId, PanelAction | null> = {
  chat: {
    label: "New chat",
    run: () => runCommand("chat.new"),
  },
  settings: null,
  recipes: null,
}

export interface SidebarProps {
  /** The active section, read from the URL by the shell. */
  section: SectionId | null
  collapsed: boolean
  /** The sidebar's own button and `Mod+\` both call this. */
  onToggle: () => void
}

/**
 * The one sidebar: the brand and its two actions on top, the section's panel in the middle,
 * and you and settings at the foot. The stylesheet scopes every rule under `.sidebar-shell`,
 * the shell's own class, so nothing here can reach the main panel beside it. Which section it
 * shows, whether it is collapsed, and its width come from the shell.
 *
 * Deliberately NOT `.chat-shell`: that name is already the `data-component`
 * handle for the app's chat pane, and a bare class of it collided with the
 * transcript's scroller once before.
 *
 * Neither collapse nor resize is animated. kat runs both on a `spring250`
 * curve; here the column is either there or it is not, because a panel that
 * takes a quarter second to get out of the way is a panel the user waits on.
 */
export function Sidebar(props: SidebarProps) {
  const collapsed = () => props.collapsed
  const shown = (): SectionId => props.section ?? "chat"
  const [visited, setVisited] = createSignal<ReadonlySet<SectionId>>(new Set())
  createEffect(() => {
    const id = props.section
    if (id && !visited().has(id)) setVisited((seen) => new Set(seen).add(id))
  })

  return (
    <aside
      class="panel"
      data-component="sidebar"
      data-panel={props.section ?? undefined}
      data-collapsed={collapsed() ? "" : undefined}
      >
      <header class="panel-header">
        <A href="/chat" class="panel-brand" data-component="sidebar-brand" aria-label="Chats">
          <IdentityAvatar seed={KIKO} size={22} />
          <span>Kiko</span>
        </A>
        <span class="flex-1" aria-hidden="true" />
        <Show when={ACTIONS[shown()]}>{(action) => <HeaderAction action={action()} />}</Show>
        <SidebarToggle open onToggle={props.onToggle} />
      </header>

      <div class="panel-scroll">
        <For each={SECTION_IDS}>
          {(id) => {
            const Panel = PANELS[id]
            return (
              <Show when={id === "chat" || visited().has(id)}>
                <div class="panel-slot" data-slot={id} data-hidden={shown() === id ? undefined : ""}>
                  <Suspense>
                    <Panel />
                  </Suspense>
                </div>
              </Show>
            )
          }}
        </For>
      </div>

      <Foot section={props.section} />
    </aside>
  )
}

/** Opens and closes the sidebar. The top bar shows the same button while the sidebar is shut. */
export function SidebarToggle(props: { open: boolean; onToggle: () => void; class?: string }) {
  return (
    <TooltipV2 placement="bottom" openDelay={400} value={props.open ? "Hide sidebar" : "Show sidebar"}>
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
        <HugeIcon icon={SidebarLeftIcon} size={17} />
      </button>
    </TooltipV2>
  )
}

/** You and settings, at the foot of every section. The card opens the account page. */
function Foot(props: { section: SectionId | null }) {
  const location = useLocation()
  const onRecipes = () => location.pathname.startsWith("/recipes")
  const user = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  return (
    <footer class="panel-foot" data-component="sidebar-foot">
      <A href="/settings/general" class="panel-me" activeClass="panel-me-active" data-component="sidebar-me" aria-label="Account">
        <IdentityAvatar seed={user()?.id ?? "you"} size={26} />
        <span class="panel-me-name">{user()?.name ?? "You"}</span>
      </A>
      <TooltipV2 placement="top" openDelay={400} value="Recipes">
        <A
          href="/recipes"
          class="panel-icon-button"
          data-component="sidebar-recipes"
          data-active={onRecipes() ? "" : undefined}
          aria-current={onRecipes() ? "page" : undefined}
          aria-label="Recipes"
        >
          <HugeIcon icon={SparklesIcon} size={17} />
        </A>
      </TooltipV2>
      <TooltipV2 placement="top" openDelay={400} value="Settings">
        <A
          href="/settings"
          class="panel-icon-button relative"
          data-component="sidebar-settings"
          data-hint="settings.open"
          data-hint-label="Settings"
          data-active={props.section === "settings" ? "" : undefined}
          aria-current={props.section === "settings" ? "page" : undefined}
          aria-label="Settings"
        >
          <HugeIcon icon={SettingsIcon} size={17} />
        </A>
      </TooltipV2>
    </footer>
  )
}

/** The compose button in the panel header. It opens the bot picker, the same as `Mod+N` and `/new`. */
function HeaderAction(props: { action: PanelAction }) {
  const navigate = useNavigate()
  return (
    <TooltipV2 placement="bottom" openDelay={400} value={props.action.label}>
      <button type="button" class="panel-icon-button" data-component="sidebar-add" aria-label={props.action.label} title={props.action.label} onClick={() => props.action.run(navigate)}>
        <HugeIcon icon={ComposeIcon} size={17} />
      </button>
    </TooltipV2>
  )
}
