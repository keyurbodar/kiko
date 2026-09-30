import { createPerPointerListeners } from "@solid-primitives/pointer"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { createSignal, For, Show } from "solid-js"
import { cn } from "../lib/cn"
import { ChatPanel } from "./chat-panel"
import { PlusIcon, RailIcon, SettingsIcon, type PanelId } from "./icons"
import "./sidebar.css"

/**
 * The rail, in kat's order. `chats` is the only one this app has a panel for;
 * the other three are kat's and are kept so the rail is the real shape, with
 * the panel body saying so rather than pretending.
 *
 * Clicking a tab selects it. Clicking the tab that is ALREADY selected toggles
 * the column instead — that is kat's `iconbar` behaviour (`if (r === e) {
 * toggleCollapse(); return }`), and it is why the rail doubles as the
 * collapse control.
 */
const PANELS: readonly { id: PanelId; label: string }[] = [
  { id: "chats", label: "chats" },
  { id: "terminal", label: "terminal" },
  { id: "code", label: "code" },
  { id: "browser", label: "browser" },
]

/** The rail's own ids: kat's four panels plus the account/settings tab. */
export type RailId = PanelId | "settings"

/** Width is a user decision, so it is clamped rather than free. */
const MIN_W = 200
const MAX_W = 420
/** Mirrors `--sidebar-content-w`; used only until the first drag. */
const DEFAULT_W = 280

export interface SidebarProps {
  class?: string
}

/**
 * The rail plus the conversation column. Rendered as a fragment, not a wrapper
 * element: kat's rail and column are siblings inside the app's flex row, and
 * the stylesheet scopes every rule under `.sidebar-shell` — the row's own class
 * in the app's markup — so nothing here can reach the transcript beside it.
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
  const [panel, setPanel] = createSignal<RailId>("chats")
  const [collapsed, setCollapsed] = createSignal(false)
  const [width, setWidth] = createSignal<number | null>(null)
  const [resizing, setResizing] = createSignal(false)

  let panelEl: HTMLElement | undefined
  let handleEl: HTMLDivElement | undefined

  const toggleSidebar = () => setCollapsed((value) => !value)

  const select = (id: RailId) => {
    if (id === panel()) {
      toggleSidebar()
      return
    }
    setPanel(id)
    setCollapsed(false)
  }

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
      <nav class="rail" aria-label="navigation" data-component="sidebar-rail">
        <For each={PANELS}>
          {(entry) => (
            <TooltipV2 placement="right" openDelay={400} value={entry.label}>
              <button
                type="button"
                class="rail-tab"
                data-component="sidebar-rail-tab"
                data-panel={entry.id}
                data-active={panel() === entry.id ? "" : undefined}
                aria-label={entry.label}
                aria-pressed={panel() === entry.id}
                onClick={() => select(entry.id)}
              >
                <RailIcon panel={entry.id} active={panel() === entry.id} />
              </button>
            </TooltipV2>
          )}
        </For>

        {/* Pushes the account tab to the bottom of the rail, exactly as kat's
            `flex:1` spacer does. */}
        <div class="rail-spacer" />

        <TooltipV2 placement="right" openDelay={400} value="settings">
          <button
            type="button"
            class="rail-tab"
            data-component="sidebar-rail-tab"
            data-panel="settings"
            data-active={panel() === "settings" ? "" : undefined}
            aria-label="settings"
            aria-pressed={panel() === "settings"}
            onClick={() => select("settings")}
          >
            <SettingsIcon active={panel() === "settings"} />
          </button>
        </TooltipV2>
      </nav>

      <aside
        ref={(el) => (panelEl = el)}
        class="panel"
        data-component="sidebar"
        data-panel={panel()}
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
          <span class="panel-title">{panel()}</span>
          <ChatPanelMenu onToggleSidebar={toggleSidebar} />
        </header>

        <div class="panel-scroll">
          <Show
            when={panel() === "chats"}
            fallback={
              <p class="px-3 py-2 text-xs text-weak" data-component="sidebar-panel-empty">
                the {panel()} panel is not built
              </p>
            }
          >
            <ChatPanel onToggleSidebar={toggleSidebar} />
          </Show>
        </div>

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

/**
 * The `+` in the panel header. kat hangs `toggle sidebar` off this affordance,
 * and it is the only entry that has somewhere real to go — a menu row with no
 * handler behind it is a lie, so nothing else is listed.
 */
function ChatPanelMenu(props: { onToggleSidebar: () => void }) {
  return (
    <MenuV2>
      <MenuV2.Trigger
        as="button"
        type="button"
        class={cn(
          "grid size-7 shrink-0 place-items-center rounded-full border-none bg-transparent p-0",
          "text-weak hover:bg-[oklch(from_var(--accent)_l_c_h_/_12%)] hover:text-text",
          "focus-visible:bg-[oklch(from_var(--accent)_l_c_h_/_12%)] focus-visible:text-text",
        )}
        data-component="sidebar-add"
        aria-label="sidebar options"
      >
        <PlusIcon />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content
          class={cn(
            "min-w-[180px] rounded-[calc(20px*var(--brm))] p-2",
            "border-none bg-menu text-base text-text shadow-menu",
          )}
          data-component="sidebar-add-menu"
        >
          <MenuV2.Item onSelect={props.onToggleSidebar}>toggle sidebar</MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
