import { createPerPointerListeners } from "@solid-primitives/pointer"
import { A, useNavigate } from "@solidjs/router"
import { type Component, createEffect, createSignal, For, lazy, Show, Suspense } from "solid-js"
import { HugeIcon } from "@yuki/ui/huge-icon"
import { ComposeIcon, SettingsIcon, SidebarLeftIcon } from "@yuki/ui/icons"
import { TooltipV2 } from "@yuki/ui/v2/tooltip-v2"
import { session } from "../app/session"
import { SECTIONS, type SectionId } from "../app/sections"
import { runCommand } from "../commands/registry"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { BrandBird } from "../mascot/brand"
import { HeaderSnow } from "./header-snow"
import { ChatPanel } from "./chat-panel"
import { MenuV2 } from "@yuki/ui/v2/menu-v2"
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
    label: "New chat",
    run: () => runCommand("chat.new"),
    menu: [
      { label: "New chat", command: "chat.new", shortcut: "⌘N" },
      { label: "New group", command: "chat.new-group" },
    ],
  },
  settings: null,
}

/** Width is a user decision, so it is clamped rather than free. */
const MIN_W = 220
const MAX_W = 420
/** Mirrors `--sidebar-content-w`; used only until the first drag. */
const DEFAULT_W = 280
/** One arrow key press on the resize handle. */
const KEY_STEP = 16

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
const WIDTH_KEY = "yuki:sidebar-width"

/** The width the reader dragged to, or null for the default. */
function readWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    return value >= MIN_W && value <= MAX_W ? Math.round(value) : null
  } catch {
    return null
  }
}

function writeWidth(value: number | null) {
  try {
    if (value === null) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, String(value))
  } catch {}
}

export function Sidebar(props: SidebarProps) {
  const collapsed = () => props.collapsed
  const setCollapsed = props.onCollapsedChange
  const [width, setWidth] = createSignal<number | null>(readWidth())
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
          return
        }
        setCollapsed(false)
        setWidth(Math.min(MAX_W, Math.round(next)))
      })
      onUp(() => {
        handleEl?.releasePointerCapture(event.pointerId)
        setResizing(false)
        writeWidth(width())
      })
    },
  })

  // The arrow keys move the edge as a drag does: past the minimum it collapses, and out again it reopens.
  const nudge = (delta: number) => {
    if (collapsed()) {
      if (delta > 0) setCollapsed(false)
      return
    }
    const next = (width() ?? DEFAULT_W) + delta
    if (next < MIN_W) return setCollapsed(true)
    setWidth(Math.min(MAX_W, next))
    writeWidth(width())
  }

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
        <HeaderSnow />
        <header class="panel-header">
          <A href="/chat" class="panel-brand" data-component="sidebar-brand" aria-label="Chats">
            <BrandBird size={22} working={useApp.bots().some((b) => b.presence === "typing" || b.presence === "working")} />
            <span>Yuki</span>
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
          aria-label="Resize sidebar"
          tabindex={0}
          aria-valuemin={MIN_W}
          aria-valuemax={MAX_W}
          aria-valuenow={collapsed() ? MIN_W : (width() ?? DEFAULT_W)}
          aria-valuetext={collapsed() ? "Collapsed" : undefined}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
            event.preventDefault()
            nudge(event.key === "ArrowRight" ? KEY_STEP : -KEY_STEP)
          }}
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
    <TooltipV2 placement="bottom" openDelay={400} value={props.open ? "Hide sidebar" : "Show sidebar"}>
      <button
        type="button"
        class={props.class ?? "panel-icon-button"}
        data-component="sidebar-toggle"
        aria-label="Toggle sidebar"
        aria-expanded={props.open}
        aria-keyshortcuts="Control+S Meta+S"
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
  const user = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  // An extension install waits for the human (architecture section 24): a dot, and the link goes to its review.
  const waiting = () => (useApp.user()?.proposals().length ?? 0) > 0
  return (
    <footer class="panel-foot" data-component="sidebar-foot">
      <A href="/settings/account" class="panel-me" activeClass="panel-me-active" data-component="sidebar-me" aria-label="Account">
        <IdentityAvatar seed={user()?.id ?? "you"} size={26} />
        <span class="panel-me-name">{user()?.name ?? "You"}</span>
      </A>
      <TooltipV2 placement="top" openDelay={400} value="Settings">
        <A
          href={waiting() ? "/settings/extensions" : "/settings"}
          class="panel-icon-button relative"
          data-component="sidebar-settings"
          data-hint="settings.open"
          data-hint-label="Settings"
          data-active={props.section === "settings" ? "" : undefined}
          aria-current={props.section === "settings" ? "page" : undefined}
          aria-label={waiting() ? "Settings, an extension waits for review" : "Settings"}
        >
          <HugeIcon icon={SettingsIcon} size={17} />
          <Show when={waiting()}>
            <span class="unread-dot panel-icon-dot" data-component="sidebar-extensions-waiting" aria-hidden="true" />
          </Show>
        </A>
      </TooltipV2>
    </footer>
  )
}

/**
 * The compose button in the panel header. On chat it is a two-item menu: "New chat" (Yuki, the same command
 * as `Mod+N` and the bird in the top bar) and "New group", which opens the same temporary chat
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
        <TooltipV2 placement="bottom" openDelay={400} value={props.action.label}>
          <button type="button" class={button} data-component="sidebar-add" aria-label={props.action.label} onClick={() => props.action.run(navigate)}>
            <HugeIcon icon={ComposeIcon} size={17} />
          </button>
        </TooltipV2>
      }
    >
      {(items) => (
        <MenuV2 gutter={6} placement="bottom-end">
          <TooltipV2 placement="bottom" openDelay={400} value={props.action.label}>
            <MenuV2.Trigger class={button} data-component="sidebar-add" aria-label={props.action.label} data-hint="chat.new" data-hint-label="New chat">
              <HugeIcon icon={ComposeIcon} size={17} />
            </MenuV2.Trigger>
          </TooltipV2>
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
