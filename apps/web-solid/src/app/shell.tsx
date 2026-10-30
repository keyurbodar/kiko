import Resizable, { type PanelContextValue, usePanelContext as useResizablePanelContext } from "@corvu/resizable"
import { useLocation, useRouter } from "@tanstack/solid-router"
import { I18nProvider, pluralCategory, pluralKey, type UiI18n } from "@kiko/ui/context/i18n"
import { dict } from "@kiko/ui/i18n/en"
import { ToastV2 } from "@kiko/ui/v2/toast-v2"
import { avatarPickerSlug } from "../avatar/picker-state"
import {
  createComputed,
  createEffect,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
  type ParentProps,
} from "solid-js"
import { viewerFor } from "../chat/computers"
import {
  closeDesk,
  deskShown,
  loadDesk,
  panelMaximized,
  setDeskCompact,
  setPanelMaximized,
} from "../chat/side/surfaces"
import ThreadDetailsLayer, { setThreadDetailsFloating, threadDetailsOpenFor } from "../chat/side/thread-details-layer"
import { preloadMessageSearch } from "../commands/message-search"

import { richLoaded } from "../composer/rich/loaded"
import { useKatCommands } from "../commands/use-kat-commands"
import { Palette, preloadPalette } from "../palette"
import { botPickerOpen } from "../chat/bot-picker-state"
import { newAgentOpen } from "../newagent/state"
import { preloadSearch, SearchOverlay, searchScope } from "../search/state"
import { bindCommandHotkeys } from "../commands/hotkeys"
import { hintsShown, watchHold } from "../commands/hints"
import { Sidebar, SidebarToggle } from "../sidebar"
import { deletingChatId } from "../sidebar/actions"
import { drawerOpen, setDrawerOpen } from "./drawer"
import { swipeAction, swipeRegion, type SwipeRegion } from "./edge-swipe"
import { coversChat, sectionOf, useChatInView } from "./sections"
import { whenIdle } from "../lib/idle"
import { Rail } from "./rail"
import { TopBar } from "./top-bar"
import { RightPanelHost } from "./right-panel-host"
import { CHAT_MIN, fitSidebar, RAIL, readWidth, resetWidth, saveWidth, SIDEBAR } from "./widths"
import HintLayer from "../commands/HintLayer"
import AvatarPicker from "../avatar/picker"
import BotPicker from "../chat/bot-picker"
import NewAgent from "../newagent/dialog"
import DeleteChatDialog from "../sidebar/delete-chat-dialog"

const idlePreloads = [loadDesk, preloadMessageSearch]

const fill = (text: string, params?: Record<string, string | number | boolean>) =>
  text.replace(/{{\s*([^}]+?)\s*}}/g, (_, key: string) => String(params?.[key] ?? ""))

const i18n: UiI18n = {
  locale: () => "en",
  t: (key, params) => fill(dict[key] ?? String(key), params),
  plural: (key, count, params) =>
    i18n.t(pluralKey(key, pluralCategory("en", count)) as never, {
      ...params,
      count,
    }),
}

const ComputerViewer = lazy(() => import("../chat/computer/Viewer"))
const Desk = lazy(loadDesk)

const KEY = "kiko:device:sidebar-collapsed"

const DETAILS_GUTTER = 324

const DETAILS_MIN_COLUMN = 560

const DETAILS_MIN_CANVAS = DETAILS_MIN_COLUMN + DETAILS_GUTTER

function readCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

function GrabPanel(props: { onGrab: (panel: PanelContextValue | undefined) => void }) {
  props.onGrab(useResizablePanelContext())
  onCleanup(() => props.onGrab(undefined))
  return null
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? "1" : "0")
  } catch {}
}

export function Shell(props: ParentProps) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const router = useRouter()
  const [collapsed, setCollapsed] = createSignal(readCollapsed())
  const narrowQuery = typeof matchMedia === "function" ? matchMedia("(width < 768px)") : undefined
  const [narrow, setNarrow] = createSignal(narrowQuery?.matches ?? false)
  const compactQuery = typeof matchMedia === "function" ? matchMedia("(width <= 980px)") : undefined
  const [compact, setCompact] = createSignal(compactQuery?.matches ?? false)
  setDeskCompact(compact())
  onMount(() => {
    const on = () => {
      setCompact(compactQuery!.matches)
      setDeskCompact(compactQuery!.matches)
    }
    compactQuery?.addEventListener("change", on)
    onCleanup(() => compactQuery?.removeEventListener("change", on))
  })
  let sidebarPanel: PanelContextValue | undefined
  const drawer = drawerOpen
  const setDrawer = setDrawerOpen
  const sideChat = useChatInView()
  const sideOpen = () => {
    const id = sideChat()
    return id !== null && deskShown()
  }
  const closeSide = closeDesk
  const maximized = () => sideOpen() && !compact() && panelMaximized()
  const inlineSide = () => (compact() || !sideOpen() ? null : sideChat())
  const sheetSide = () => (compact() && sideOpen() ? sideChat() : null)
  onMount(() => {
    const root = document.documentElement
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Tab") root.dataset.input = "keys"
    }
    const pointer = () => delete root.dataset.input
    window.addEventListener("keydown", keys, true)
    window.addEventListener("pointerdown", pointer, true)
    onCleanup(() => {
      window.removeEventListener("keydown", keys, true)
      window.removeEventListener("pointerdown", pointer, true)
    })
  })
  onMount(() => {
    const on = () => {
      setNarrow(narrowQuery!.matches)
      setDrawer(false)
    }
    narrowQuery?.addEventListener("change", on)
    onCleanup(() => narrowQuery?.removeEventListener("change", on))
  })
  createEffect(() => {
    if (!(narrow() && drawer()) && !sheetSide() && !maximized()) return
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      if (sheetSide()) return closeSide()
      if (maximized()) return setPanelMaximized(false)
      setDrawer(false)
    }
    window.addEventListener("keydown", on)
    onCleanup(() => window.removeEventListener("keydown", on))
  })
  createEffect(() => {
    if (!narrow()) return
    let start: { x: number; y: number; region: SwipeRegion } | null = null
    const down = (e: TouchEvent) => {
      const t = e.touches[0]
      start =
        e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, region: swipeRegion(e.target, t.clientX) } : null
    }
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      if (!start || !t) return
      const action = swipeAction(
        { drawer: drawer(), sidecar: sideOpen() },
        start.region,
        t.clientX - start.x,
        t.clientY - start.y,
      )
      start = null
      if (action === "open-drawer") setDrawer(true)
      else if (action === "close-drawer") setDrawer(false)
      else if (action === "close-sidecar") closeDesk()
    }
    window.addEventListener("touchstart", down, { passive: true })
    window.addEventListener("touchend", up, { passive: true })
    onCleanup(() => {
      window.removeEventListener("touchstart", down)
      window.removeEventListener("touchend", up)
    })
  })
  const closed = () => (narrow() ? !drawer() : collapsed())
  const [railShown, setRailShown] = createSignal(collapsed())
  const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  let mounted = false
  let settling = false
  onMount(() => requestAnimationFrame(() => (mounted = true)))
  const slidingPanels = () => [
    ...document.querySelectorAll<HTMLElement>(
      '[data-component="app-panels"] > [data-component="sidebar-panel"], [data-component="app-panels"] > [data-component="chat-panel"]',
    ),
  ]
  const dropSlide = () => {
    for (const panel of slidingPanels()) panel.classList.remove("motion-slide")
  }
  const slide = () => {
    if (!mounted || reducedMotion()) return
    for (const panel of slidingPanels()) panel.classList.add("motion-slide")
  }
  const finishCollapse = () => {
    if (!settling) return
    settling = false
    if (sidebarPanel?.collapsed()) setRailShown(true)
  }
  const settleSidebar = (event: Event) => {
    if (
      !(event instanceof TransitionEvent) ||
      event.propertyName !== "flex-basis" ||
      event.target !== event.currentTarget
    )
      return
    dropSlide()
    finishCollapse()
  }
  const beginSidebarDrag = () => {
    dropSlide()
    finishCollapse()
  }
  const watchSidebarPanel = (el: Element) => {
    el.addEventListener("transitionend", settleSidebar)
    onCleanup(() => el.removeEventListener("transitionend", settleSidebar))
  }
  const setAndSave = (value: boolean) => {
    setCollapsed(value)
    writeCollapsed(value)
  }
  const expandSidebar = (panel: PanelContextValue) => {
    setRailShown(false)
    settling = false
    slide()
    panel.expand()
    panel.resize(`${readWidth(SIDEBAR)}px`)
  }
  const collapseSidebar = (panel: PanelContextValue) => {
    const instant = !mounted || reducedMotion()
    settling = !instant
    if (instant) setRailShown(true)
    slide()
    panel.collapse()
  }
  const toggle = () => {
    if (narrow()) return setDrawer(!drawer())
    const panel = sidebarPanel
    if (!panel) return
    if (railShown() || panel.collapsed()) expandSidebar(panel)
    else collapseSidebar(panel)
  }
  createEffect((prev: string | undefined) => {
    const path = pathname()
    if (prev !== undefined && prev !== path && narrow()) setDrawer(false)
    return path
  })
  useKatCommands({ toggleSidebar: toggle })
  onMount(() => {
    bindCommandHotkeys()
  })
  onMount(() => {
    if (sideOpen()) void loadDesk()
    whenIdle(() => {
      void router.preloadRoute({ to: "/settings/models" }).catch(() => {})
      preloadSearch()
      preloadPalette()
      setTimeout(() => void import("../settings/catalog").then((m) => m.prefetchCatalog()), 3000)
    })
  })
  createEffect(() => {
    if (!richLoaded()) return
    for (const load of idlePreloads) void load()
  })
  onMount(() => onCleanup(watchHold()))
  onMount(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      preloadPalette()
      preloadSearch()
      window.removeEventListener("keydown", on, true)
    }
    window.addEventListener("keydown", on, true)
    onCleanup(() => window.removeEventListener("keydown", on, true))
  })
  const sidebar = () => <Sidebar section={sectionOf(pathname())} collapsed={narrow() && closed()} onToggle={toggle} />
  const onChat = () => !coversChat(pathname())
  const [canvasWidth, setCanvasWidth] = createSignal(0)
  const watchCanvas = (el: Element) => {
    if (!(el instanceof HTMLElement)) return
    const measure = () => setCanvasWidth(el.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  }
  const detailsChat = () => {
    const id = sideChat()
    return id !== null && onChat() && threadDetailsOpenFor(id) ? id : null
  }
  const detailsInline = () => canvasWidth() >= DETAILS_MIN_CANVAS
  createComputed(() => setThreadDetailsFloating(!detailsInline()))
  const detailsReserved = () => detailsChat() !== null && detailsInline()
  onMount(() => {
    let frame = 0
    let last = window.innerWidth
    const on = () => {
      if (window.innerWidth === last) return
      last = window.innerWidth
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const room = window.innerWidth - CHAT_MIN
          if (!sidebarPanel || sidebarPanel.collapsed() || readWidth(SIDEBAR) <= room) return
          sidebarPanel.resize(`${Math.max(SIDEBAR.min, room)}px`)
        })
      })
    }
    window.addEventListener("resize", on)
    onCleanup(() => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", on)
    })
  })
  return (
    <I18nProvider value={i18n}>
      <div
        class="sidebar-shell relative flex h-dvh overflow-hidden bg-side"
        data-component="app-shell"
        data-section={(onChat() && sectionOf(pathname())) || undefined}
      >
        <Show when={narrow()}>{sidebar()}</Show>
        <Show when={narrow() && drawer()}>
          <div
            class="drawer-scrim"
            data-component="drawer-scrim"
            aria-hidden="true"
            onPointerDown={() => setDrawer(false)}
          />
        </Show>
        <Show when={narrow() ? "narrow" : compact() ? "compact" : "wide"} keyed>
          {(_mode) => {
            const sidebarSize = narrow() ? 0 : fitSidebar(window.innerWidth, collapsed() ? RAIL : readWidth(SIDEBAR))
            const sizes = { sidebar: sidebarSize / window.innerWidth, chat: 1 - sidebarSize / window.innerWidth }
            return (
              <Resizable
                class="min-w-0 flex-1"
                keyboardDelta="16px"
                handleCursorStyle={false}
                data-component="app-panels"
              >
                <Show when={!narrow()}>
                  <Resizable.Panel
                    panelId="kiko-sidebar-panel"
                    class="shell-panel"
                    data-component="sidebar-panel"
                    initialSize={sizes.sidebar}
                    minSize={`${SIDEBAR.min}px`}
                    maxSize={`${SIDEBAR.max}px`}
                    collapsible
                    collapsedSize={`${RAIL}px`}
                    ref={watchSidebarPanel}
                    onCollapse={() => {
                      setAndSave(true)
                      if (!settling) setRailShown(true)
                    }}
                    onExpand={() => {
                      setAndSave(false)
                      settling = false
                      setRailShown(false)
                    }}
                  >
                    <GrabPanel onGrab={(panel) => (sidebarPanel = panel)} />
                    {railShown() ? <Rail onExpand={toggle} /> : sidebar()}
                  </Resizable.Panel>
                  <Resizable.Handle
                    class="resize-handle"
                    data-component="sidebar-resize"
                    aria-label="Resize sidebar"
                    altKey={false}
                    onHandleDragStart={beginSidebarDrag}
                    onHandleDragEnd={() => saveWidth(SIDEBAR, "kiko-sidebar-panel")}
                    onKeyUp={() => saveWidth(SIDEBAR, "kiko-sidebar-panel")}
                    onDblClick={() => resetWidth(SIDEBAR, sidebarPanel)}
                  />
                </Show>
                <Resizable.Panel
                  class="shell-panel"
                  data-component="chat-panel"
                  initialSize={sizes.chat}
                  minSize={`${CHAT_MIN}px`}
                >
                  <div class="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-component="workspace-row">
                    <main
                      class="relative flex min-w-0 flex-col overflow-hidden"
                      classList={{ "flex-1": !maximized(), "w-0 flex-none": maximized() }}
                      data-component="main-column"
                      data-maximized-away={maximized() ? "" : undefined}
                      inert={maximized() || undefined}
                    >
                      <Show when={onChat()}>
                        <TopBar chatId={sideChat()} sidebarOpen={!narrow() || !closed()} onToggleSidebar={toggle} />
                      </Show>
                      <Show when={narrow() && closed() && !onChat()}>
                        <SidebarToggle open={false} onToggle={toggle} class="main-sidebar-toggle" />
                      </Show>
                      <div
                        class="main-row relative flex min-h-0 min-w-0 flex-1"
                        data-component="main-row"
                        data-top={onChat() ? undefined : ""}
                      >
                        <div
                          class="main-panel relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
                          data-component="main-panel"
                          ref={watchCanvas}
                        >
                          <div
                            class="details-reserve flex min-w-0 flex-1 flex-col"
                            data-on={detailsReserved() ? "" : undefined}
                          >
                            {props.children}
                          </div>
                          <Show when={onChat() && detailsChat()}>
                            <Suspense>
                              <ThreadDetailsLayer chatId={detailsChat()!} inline={detailsInline()} />
                            </Suspense>
                          </Show>
                        </div>
                        <Show when={searchScope()}>
                          <Suspense>
                            <SearchOverlay />
                          </Suspense>
                        </Show>
                      </div>
                    </main>
                    <Show when={inlineSide()} keyed>
                      {(chatId) => (
                        <RightPanelHost maximized={maximized()}>
                          <Suspense>
                            <Desk chatId={chatId} onClose={closeSide} />
                          </Suspense>
                        </RightPanelHost>
                      )}
                    </Show>
                  </div>
                </Resizable.Panel>
              </Resizable>
            )
          }}
        </Show>
        <Show when={sheetSide()} keyed>
          {(chatId) => (
            <>
              <div
                class="drawer-scrim sidecar-scrim"
                data-component="sidecar-scrim"
                aria-hidden="true"
                onPointerDown={closeSide}
              />
              <div class="sidecar-overlay" data-component="sidecar-overlay" data-mode="sheet">
                <Suspense>
                  <Desk chatId={chatId} onClose={closeSide} sheet />
                </Suspense>
              </div>
            </>
          )}
        </Show>
        <Suspense>
          <Palette />
        </Suspense>
        <Show when={deletingChatId() !== null}>
          <Suspense>
            <DeleteChatDialog />
          </Suspense>
        </Show>
        <Show when={botPickerOpen()}>
          <Suspense>
            <BotPicker />
          </Suspense>
        </Show>
        <Show when={newAgentOpen()}>
          <Suspense>
            <NewAgent />
          </Suspense>
        </Show>
        <Show when={hintsShown()}>
          <Suspense>
            <HintLayer />
          </Suspense>
        </Show>
        <Show when={viewerFor()}>
          <Suspense>
            <ComputerViewer />
          </Suspense>
        </Show>
        <ToastV2.Region />
        <Show when={avatarPickerSlug()}>
          <Suspense>
            <AvatarPicker />
          </Suspense>
        </Show>
      </div>
    </I18nProvider>
  )
}
