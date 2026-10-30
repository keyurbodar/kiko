import Resizable, {
  type ContextValue,
  type PanelContextValue,
  useContext as useResizableContext,
  usePanelContext as useResizablePanelContext,
} from "@corvu/resizable"
import { useLocation, useRouter } from "@tanstack/solid-router"
import { I18nProvider, pluralCategory, pluralKey, type UiI18n } from "@kiko/ui/context/i18n"
import { dict } from "@kiko/ui/i18n/en"
import { ToastV2 } from "@kiko/ui/v2/toast-v2"
import { avatarPickerSlug } from "../avatar/picker-state"
import { createEffect, createSignal, lazy, on, onCleanup, onMount, Show, Suspense, type ParentProps } from "solid-js"
import { viewerFor } from "../chat/computers"
import {
  closeDesk,
  deskShown,
  loadDesk,
  panelMaximized,
  setDeskCompact,
  setPanelMaximized,
} from "../chat/side/surfaces"
import ThreadDetailsLayer, { threadDetailsOpenFor } from "../chat/side/thread-details-layer"
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
import {
  CHAT_MIN,
  defaultWidth,
  fitWidths,
  INFO,
  initialSizes,
  PANEL_CHAT_MIN,
  panelMaxWidth,
  readPanelWidth,
  readWidth,
  resetWidth,
  saveWidth,
  SIDEBAR,
} from "./widths"
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

function readCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

function GrabLayout(props: { onGrab: (layout: ContextValue) => void }) {
  props.onGrab(useResizableContext())
  return null
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
  const compactQuery = typeof matchMedia === "function" ? matchMedia("(width < 960px)") : undefined
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
  const [sidePanel, setSidePanel] = createSignal<PanelContextValue | undefined>()
  const [layout, setLayout] = createSignal<ContextValue | undefined>()
  const [viewport, setViewport] = createSignal(typeof window === "undefined" ? 1440 : window.innerWidth)
  const [groupWidthSignal, setGroupWidthSignal] = createSignal(0)
  const [sideWidth, setSideWidth] = createSignal(readPanelWidth(window.innerWidth))
  let groupWidth = 0
  const watchGroup = (el: Element) => {
    if (!(el instanceof HTMLElement)) return
    const measure = () => {
      groupWidth = el.getBoundingClientRect().width
      setGroupWidthSignal(groupWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  }
  const setColumnWidth = (index: number, px: number) => {
    const ctx = layout()
    if (!ctx) return
    const total = groupWidth > 0 ? groupWidth : window.innerWidth
    const sizes = [...ctx.sizes()]
    if (index >= sizes.length) return
    const want = Math.max(0, px) / total
    const delta = want - sizes[index]
    if (Math.abs(delta) < 0.0005) return
    sizes[index] = want
    const chat = sizes.length === 3 ? 1 : 0
    sizes[chat] = Math.max(CHAT_MIN / total, sizes[chat] - delta)
    const sum = sizes.reduce((a, b) => a + b, 0)
    ctx.setSizes(sizes.map((size) => size / sum))
  }
  const drawer = drawerOpen
  const setDrawer = setDrawerOpen
  const sideChat = useChatInView()
  const sideOpen = () => {
    const id = sideChat()
    return id !== null && deskShown()
  }
  const closeSide = closeDesk
  const maximized = () => sideOpen() && !compact() && panelMaximized()
  const groupWidthNow = () => (groupWidthSignal() > 0 ? groupWidthSignal() : viewport())
  const sidebarWidth = () => {
    const ctx = layout()
    if (!ctx) return 0
    const sizes = ctx.sizes()
    return sizes.length === 3 ? sizes[0]! * groupWidthNow() : 0
  }
  const dockFits = () => groupWidthNow() - sidebarWidth() - sideWidth() >= PANEL_CHAT_MIN
  const dockedSide = () => (compact() || !sideOpen() || maximized() || !dockFits() ? null : sideChat())
  const overlaidSide = () => (!sideOpen() || dockedSide() !== null ? null : sideChat())
  const overlayMode = () => (maximized() ? "max" : compact() ? "sheet" : "float")
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
    if (!(narrow() && drawer()) && !overlaidSide()) return
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      if (!overlaidSide()) return setDrawer(false)
      if (overlayMode() === "max") setPanelMaximized(false)
      else closeSide()
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
  let mounted = false
  let sliding: ReturnType<typeof setTimeout> | undefined
  onMount(() => requestAnimationFrame(() => (mounted = true)))
  onCleanup(() => clearTimeout(sliding))
  const slide = () => {
    if (!mounted) return
    const panels = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-component="app-panels"] > [data-component="sidebar-panel"], [data-component="app-panels"] > [data-component="chat-panel"]',
      ),
    ]
    for (const panel of panels) panel.classList.add("motion-slide")
    clearTimeout(sliding)
    sliding = setTimeout(() => {
      for (const panel of panels) panel.classList.remove("motion-slide")
    }, 320)
  }
  const setAndSave = (value: boolean) => {
    setCollapsed(value)
    writeCollapsed(value)
  }
  const toggle = () => {
    if (narrow()) return setDrawer(!drawer())
    if (!sidebarPanel) return
    slide()
    if (sidebarPanel.collapsed()) {
      sidebarPanel.expand()
      sidebarPanel.resize(`${readWidth(SIDEBAR)}px`)
    } else sidebarPanel.collapse()
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
  const sidebar = () => <Sidebar section={sectionOf(pathname())} collapsed={closed()} onToggle={toggle} />
  const onChat = () => !coversChat(pathname())
  const [canvasWidth, setCanvasWidth] = createSignal(0)
  const [messageWidth, setMessageWidth] = createSignal(820)
  const watchCanvas = (el: Element) => {
    if (!(el instanceof HTMLElement)) return
    const measure = () => {
      const width = el.getBoundingClientRect().width
      setCanvasWidth(width)
      const raw = getComputedStyle(el).getPropertyValue("--chat-content-max-width").trim()
      const px = raw.endsWith("%") ? (width * parseFloat(raw)) / 100 : parseFloat(raw)
      if (Number.isFinite(px) && px > 0) setMessageWidth(px)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  }
  const detailsChat = () => {
    const id = sideChat()
    return id !== null && onChat() && threadDetailsOpenFor(id) ? id : null
  }
  const detailsInline = () => {
    if (sideOpen() || canvasWidth() === 0) return false
    return (canvasWidth() - Math.min(canvasWidth(), messageWidth())) / 2 >= 296 + 24
  }
  const endSideResize = () => {
    if (sidePanel()?.collapsed()) return closeSide()
    saveWidth(INFO, "kiko-sidecar-panel")
    setSideWidth(readPanelWidth(viewport()))
  }
  createEffect(
    on(dockedSide, () => {
      setSideWidth(readPanelWidth(viewport()))
      requestAnimationFrame(() => {
        const ctx = layout()
        if (!ctx) return
        const sizes = ctx.sizes()
        const index = sizes.length - 1
        if (index < 1) return
        setColumnWidth(index, dockedSide() ? readPanelWidth(viewport()) : 0)
      })
    }),
  )
  onMount(() => {
    let frame = 0
    let last = window.innerWidth
    const on = () => {
      if (window.innerWidth === last) return
      last = window.innerWidth
      setViewport(window.innerWidth)
      setSideWidth(readPanelWidth(window.innerWidth))
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const ctx = layout()
          if (ctx && dockedSide()) setColumnWidth(ctx.sizes().length - 1, readPanelWidth(window.innerWidth))
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
        <Show when={!narrow() && collapsed()}>
          <Rail onExpand={toggle} />
        </Show>
        <Show when={narrow() ? "narrow" : compact() ? "compact" : "wide"} keyed>
          {(_mode) => {
            const fitted = fitWidths(
              window.innerWidth,
              narrow() ? 0 : collapsed() ? 0 : readWidth(SIDEBAR),
              compact() ? 0 : dockedSide() ? readPanelWidth(window.innerWidth) : 0,
            )
            const sizes = initialSizes(
              window.innerWidth,
              narrow() ? null : fitted.sidebar,
              compact() ? null : dockedSide() ? fitted.info : 0,
            )
            return (
              <Resizable
                class="min-w-0 flex-1"
                keyboardDelta="16px"
                handleCursorStyle={false}
                data-component="app-panels"
                ref={watchGroup}
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
                    collapsedSize={0}
                    onCollapse={() => setAndSave(true)}
                    onExpand={() => setAndSave(false)}
                  >
                    <GrabPanel onGrab={(panel) => (sidebarPanel = panel)} />
                    {sidebar()}
                  </Resizable.Panel>
                  <Resizable.Handle
                    class="resize-handle"
                    data-component="sidebar-resize"
                    aria-label="Resize sidebar"
                    altKey={false}
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
                  <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden" data-component="main-column">
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
                        <div class="flex min-w-0 flex-1 flex-col">{props.children}</div>
                        <Show when={onChat() && detailsChat()}>
                          <ThreadDetailsLayer chatId={detailsChat()!} inline={detailsInline()} />
                        </Show>
                      </div>
                      <Show when={searchScope()}>
                        <Suspense>
                          <SearchOverlay />
                        </Suspense>
                      </Show>
                    </div>
                  </main>
                </Resizable.Panel>
                <Show when={!compact()}>
                  <GrabLayout onGrab={setLayout} />
                  <Resizable.Handle
                    class="resize-handle"
                    data-component="sidecar-resize"
                    aria-label="Resize side panel"
                    altKey={false}
                    disabled={!dockedSide()}
                    onHandleDragEnd={endSideResize}
                    onKeyUp={endSideResize}
                    onDblClick={() => {
                      const want = defaultWidth(INFO)
                      try {
                        localStorage.setItem(INFO.key, String(want))
                      } catch {}
                      setColumnWidth(layout() ? layout()!.sizes().length - 1 : 2, want)
                    }}
                  />
                  <Resizable.Panel
                    panelId="kiko-sidecar-panel"
                    class="shell-panel"
                    data-component="sidecar-column"
                    initialSize={sizes.info}
                    minSize={`${INFO.min}px`}
                    maxSize={`${panelMaxWidth(viewport())}px`}
                    collapsible
                    collapsedSize={0}
                  >
                    <GrabPanel onGrab={setSidePanel} />
                    <Show when={dockedSide()} keyed>
                      {(chatId) => (
                        <Suspense>
                          <Desk chatId={chatId} onClose={closeSide} />
                        </Suspense>
                      )}
                    </Show>
                  </Resizable.Panel>
                </Show>
              </Resizable>
            )
          }}
        </Show>
        <Show when={overlaidSide()} keyed>
          {(chatId) => (
            <>
              <Show when={overlayMode() !== "max"}>
                <div
                  class="drawer-scrim sidecar-scrim"
                  data-component="sidecar-scrim"
                  aria-hidden="true"
                  onPointerDown={closeSide}
                />
              </Show>
              <div
                class="sidecar-overlay"
                data-component="sidecar-overlay"
                data-mode={overlayMode()}
                style={
                  overlayMode() === "max"
                    ? { left: `${sidebarWidth()}px`, right: "0px", top: "var(--frame-gap)", bottom: "var(--frame-gap)" }
                    : undefined
                }
              >
                <Suspense>
                  <Desk chatId={chatId} onClose={closeSide} sheet={overlayMode() !== "max"} />
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
