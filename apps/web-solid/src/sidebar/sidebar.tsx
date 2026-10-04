import { createPerPointerListeners } from "@solid-primitives/pointer"
import { A, useNavigate } from "@solidjs/router"
import { type Component, createEffect, createSignal, For, lazy, Show, Suspense } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { session } from "../app/session"
import { SECTIONS, type SectionId } from "../app/sections"
import { runCommand } from "../commands/registry"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { Bird } from "../mascot/bird"
import { ChatPanel } from "./chat-panel"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import "./sidebar.css"

/*
 * One panel per section, chosen from this table. Chat paints with the first frame; the others
 * load the first time their section opens, and then stay mounted so each keeps its scroll.
 */
const PANELS: Record<SectionId, Component> = {
  chat: ChatPanel,
  settings: lazy(() => import("./settings/sidebar")),
}
const SECTION_IDS = SECTIONS.map((section) => section.id)

type PanelAction = {
  label: string
  run: (navigate: (to: string) => void) => void
  /** When set, the + opens this menu of commands instead of running `run`. */
  menu?: { label: string; command: string; shortcut?: string }[]
}

/** The header's one primary action. Settings has none. */
const ACTIONS: Record<SectionId, PanelAction | null> = {
  chat: {
    label: "new chat",
    run: () => runCommand("chat.new"),
    menu: [
      { label: "new chat", command: "chat.new", shortcut: "⌘N" },
      { label: "new group", command: "chat.new-group" },
    ],
  },
  settings: null,
}

/** Width is a user decision, so it is clamped rather than free. */
const MIN_W = 220
const MAX_W = 420
/** Mirrors `--sidebar-content-w`; used only until the first drag. */
const DEFAULT_W = 272

export interface SidebarProps {
  /** The active section, read from the URL by the shell. */
  section: SectionId | null
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  /** The sidebar's own button and `cmd+s` both call this. */
  onToggle: () => void
}

/**
 * The one sidebar: the brand and its two actions on top, the section's panel in the middle,
 * and you and settings at the foot. The stylesheet scopes every rule under `.sidebar-shell`,
 * the shell's own class, so nothing here can reach the main panel beside it. Which section it
 * shows, and whether it is collapsed, come from the shell; only its width is its own.
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
  const setCollapsed = props.onCollapsedChange
  const [width, setWidth] = createSignal<number | null>(null)
  const [resizing, setResizing] = createSignal(false)
  const [visited, setVisited] = createSignal<ReadonlySet<SectionId>>(new Set())
  createEffect(() => {
    const id = props.section
    if (id && !visited().has(id)) setVisited((seen) => new Set(seen).add(id))
  })

  let panelEl: HTMLElement | undefined
  let handleEl: HTMLDivElement | undefined

  /*
   * Drag to resize. `createPerPointerListeners` follows one pointer from its
   * `down` to its `up` regardless of where it travels, so a drag that leaves
   * the 3px handle keeps working — which is the whole reason it is used here
   * instead of `onPointerMove` on the handle itself.
   *
   * The starting width is read from the element rather than from the signal:
   * before the first drag the signal is null and the live width comes from the
   * token, and reading the rect is correct in both cases.
   */
  createPerPointerListeners({
    // `createEventListener` attaches only once the accessor resolves, so the
    // handle is legitimately undefined on the first tick — this primitive's
    // signature is narrower than its implementation.
    target: (() => handleEl) as () => EventTarget,
    passive: false,
    onDown: (event, onMove, onUp) => {
      event.preventDefault()
      /*
       * The handle is 3px wide and the primitive listens for `pointermove` on
       * its target, so without capture the pointer leaves the handle on the
       * first pixel of travel and the drag dies with no move events ever
       * arriving. Capturing retargets every move back to the handle for the
       * rest of the gesture, which is what makes a narrow grab bar usable.
       */
      handleEl?.setPointerCapture(event.pointerId)
      const startX = event.clientX
      // Reads 0 while collapsed, which is exactly the origin a drag back out
      // should grow from.
      const startW = panelEl?.getBoundingClientRect().width ?? DEFAULT_W
      setResizing(true)
      onMove((move) => {
        const next = startW + (move.clientX - startX)
        /*
         * Past the minimum the panel does not stop at a floor and refuse to
         * move: it collapses. A floor would leave the panel pinned at 200px
         * with the pointer somewhere out to its left, which reads as the drag
         * having broken. Coming back out is the same gesture in reverse, and
         * `startW` being 0 while collapsed is what makes that work.
         */
        if (next < MIN_W) {
          setCollapsed(true)
          setWidth(null)
          return
        }
        setCollapsed(false)
        setWidth(Math.min(MAX_W, Math.round(next)))
      })
      onUp(() => {
        handleEl?.releasePointerCapture(event.pointerId)
        setResizing(false)
      })
    },
  })

  return (
    <>
      <aside
        ref={(el) => (panelEl = el)}
        class="panel"
        data-component="sidebar"
        data-panel={props.section ?? undefined}
        data-collapsed={collapsed() ? "" : undefined}
        data-resizing={resizing() ? "" : undefined}
        /*
         * The width override goes on the token, not on `width`. Children carry
         * `min-width: var(--sidebar-content-w)` so they hold their laid-out size
         * while the column is collapsing instead of reflowing on every frame;
         * declaring the width directly would leave them fighting it.
         */
        style={{ "--sidebar-content-w": width() === null ? undefined : `${width()}px` }}
      >
        <header class="panel-header">
          <A href="/chat" class="panel-brand" data-component="sidebar-brand" aria-label="chats">
            <Bird spec={{ species: "kiko", tint: 0, accessory: "none" }} size={22} />
            <span>kiko</span>
          </A>
          <span class="flex-1" aria-hidden="true" />
          <Show when={props.section && ACTIONS[props.section]}>{(action) => <HeaderAction action={action()} />}</Show>
          <SidebarToggle open onToggle={props.onToggle} />
        </header>

        <div class="panel-scroll">
          <For each={SECTION_IDS}>
            {(id) => {
              const Panel = PANELS[id]
              return (
                <Show when={id === "chat" || visited().has(id)}>
                  <div class="panel-slot" data-slot={id} data-hidden={props.section === id ? undefined : ""}>
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

        {/* The handle lives INSIDE the panel, not beside it: the panel is the
            positioned ancestor, so `right: -1.5px` lands on the panel's edge.
            As a sibling it resolved against the viewport instead and floated at
            the far right of the window. The panel's `overflow-clip-margin` is
            what lets the 1.5px bleed survive its `overflow: clip`.
            
            It also stays mounted while collapsed — at width 0 it sits on the
            rail's edge, which is precisely where a drag back out has to start,
            so unmounting it would make the collapse one-way. */}
        <div
          ref={(el) => (handleEl = el)}
          class="resize-handle"
          data-component="sidebar-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="resize sidebar"
          aria-valuemin={MIN_W}
          aria-valuemax={MAX_W}
          aria-valuenow={collapsed() ? 0 : (width() ?? DEFAULT_W)}
          onDblClick={() => {
            setCollapsed(false)
            setWidth(null)
          }}
        />
      </aside>
    </>
  )
}

/** Opens and closes the sidebar. The top bar shows the same button while the sidebar is shut. */
export function SidebarToggle(props: { open: boolean; onToggle: () => void; class?: string }) {
  return (
    <TooltipV2 placement="bottom" openDelay={400} value={props.open ? "hide sidebar" : "show sidebar"}>
      <button
        type="button"
        class={props.class ?? "panel-icon-button"}
        data-component="sidebar-toggle"
        aria-label="toggle sidebar"
        aria-expanded={props.open}
        aria-keyshortcuts="Control+S Meta+S"
        data-hint="view.toggle-sidebar"
        onClick={() => props.onToggle()}
      >
        <HugeIcon name="sidebar-left" size={17} />
      </button>
    </TooltipV2>
  )
}

/** You and settings, at the foot of every section. The card opens the account page. */
function Foot(props: { section: SectionId | null }) {
  const user = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  return (
    <footer class="panel-foot" data-component="sidebar-foot">
      <A href="/settings/account" class="panel-me" activeClass="panel-me-active" data-component="sidebar-me" aria-label="account">
        <IdentityAvatar seed={user()?.id ?? "you"} size={26} />
        <span class="panel-me-name">{(user()?.name ?? "you").toLowerCase()}</span>
      </A>
      <TooltipV2 placement="top" openDelay={400} value="settings">
        <A
          href="/settings"
          class="panel-icon-button"
          data-component="sidebar-settings"
          data-hint="settings.open"
          data-hint-label="settings"
          data-active={props.section === "settings" ? "" : undefined}
          aria-current={props.section === "settings" ? "page" : undefined}
          aria-label="settings"
        >
          <HugeIcon name="settings" size={17} />
        </A>
      </TooltipV2>
    </footer>
  )
}

/**
 * The compose button in the panel header. On chat it is a two-item menu: "new chat" (kiko, the same command
 * as `Mod+N` and the bird in the top bar) and "new group", which opens the same temporary chat
 * with its "to:" search already open. It does not own the sidebar toggle; the rail icon and
 * `cmd+s` do.
 */
function HeaderAction(props: { action: PanelAction }) {
  const navigate = useNavigate()
  const button = "panel-icon-button"
  return (
    <Show
      when={props.action.menu}
      fallback={
        <button type="button" class={button} data-component="sidebar-add" aria-label={props.action.label} onClick={() => props.action.run(navigate)}>
          <HugeIcon name="compose" size={17} />
        </button>
      }
    >
      {(items) => (
        <MenuV2 gutter={6} placement="bottom-end">
          <MenuV2.Trigger class={button} data-component="sidebar-add" aria-label={props.action.label} data-hint="chat.new" data-hint-label="new chat">
            <HugeIcon name="compose" size={17} />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content data-component="sidebar-add-menu">
              <For each={items()}>
                {(item) => (
                  <MenuV2.Item shortcut={item.shortcut} onSelect={() => runCommand(item.command)}>
                    {item.label}
                  </MenuV2.Item>
                )}
              </For>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      )}
    </Show>
  )
}
