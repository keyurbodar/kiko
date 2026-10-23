import Resizable, {
  type ContextValue,
  type PanelContextValue,
  useContext as useResizableContext,
  usePanelContext as useResizablePanelContext,
} from "@corvu/resizable"
import { useLocation } from "@solidjs/router"
import { I18nProvider, pluralCategory, pluralKey, type UiI18n } from "@kiko/ui/context/i18n"
import { dict } from "@kiko/ui/i18n/en"
import { ToastV2 } from "@kiko/ui/v2/toast-v2"
import { avatarPickerSlug } from "../avatar/picker-state"
import {
  createEffect,
  createSignal,
  getOwner,
  lazy,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
  Suspense,
  type ParentProps,
} from "solid-js"
import { viewerFor } from "../chat/computers"
import { closeSidecar, loadSidecar, sidecarOpen } from "../chat/side/surfaces"
import { preloadMessageMenu } from "../chat/ui/MessageMenu"
import { preloadModelPicker } from "../settings/model-picker"
import { preloadMessageSearch } from "../commands/message-search"

import { richLoaded } from "../composer/rich/loaded"
import { CARD_WIDTH, cardBeside, cardShown, loadCard, setCardRoom } from "../chat/side/card-state"
import { useKatCommands } from "../commands/use-kat-commands"
import { Palette, preloadPalette } from "../palette"
import { botPickerOpen } from "../chat/bot-picker-state"
import { newAgentOpen } from "../newagent/state"
import { preloadSearch, SearchOverlay, searchScope } from "../search/state"
import { settingsSection } from "../settings/dialog-state"
import { hintsShown, watchHold } from "../commands/hints"
const HintLayer = lazy(() => import("../commands/HintLayer"))
import { Sidebar, SidebarToggle } from "../sidebar"
import { deletingChatId } from "../sidebar/actions"
import { drawerOpen, setDrawerOpen } from "./drawer"
import { swipeAction, swipeRegion, type SwipeRegion } from "./edge-swipe"
import { sectionOf } from "./sections"
import { whenIdle } from "../lib/idle"
import { TopBar } from "./top-bar"
import {
  CHAT_MIN,
  defaultWidth,
  fitWidths,
  INFO,
  initialSizes,
  readWidth,
  resetWidth,
  saveWidth,
  SIDEBAR,
} from "./widths"

const idlePreloads = [preloadMessageMenu, preloadModelPicker, preloadMessageSearch]

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

const Sidecar = lazy(loadSidecar)
const ChatCard = lazy(loadCard)
const watchPanel = (el: HTMLElement) => {
  const observer = new ResizeObserver(([entry]) => setCardRoom(entry?.contentRect.width ?? 0))
  observer.observe(el)
  onCleanup(() => observer.disconnect())
}
const AvatarPicker = lazy(() => import("../avatar/picker"))
const BotPicker = lazy(() => import("../chat/bot-picker"))
const NewAgent = lazy(() => import("../newagent/dialog"))
const SettingsDialog = lazy(() => import("../settings/settings-dialog"))
const ComputerViewer = lazy(() => import("../chat/computer/Viewer"))
const DeleteChatDialog = lazy(() => import("../sidebar/delete-chat-dialog"))
const CHAT_PATH = /^\/chat\/([^/]+)\/?$/

function PageSkeleton() {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 p-6" data-component="page-skeleton" aria-hidden="true">
      <span class="motion-skeleton h-6 w-40 rounded-md" />
      <span class="motion-skeleton h-4 w-64 rounded-md" />
      <span class="motion-skeleton mt-2 h-24 w-full rounded-lg" />
      <span class="motion-skeleton h-4 w-3/4 rounded-md" />
    </div>
  )
}

const KEY = "kiko:sidebar-collapsed"

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
  const location = useLocation()
  const [collapsed, setCollapsed] = createSignal(readCollapsed())
  const narrowQuery = typeof matchMedia === "function" ? matchMedia("(width < 768px)") : undefined
  const [narrow, setNarrow] = createSignal(narrowQuery?.matches ?? false)
  const compactQuery = typeof matchMedia === "function" ? matchMedia("(width < 960px)") : undefined
  const [compact, setCompact] = createSignal(compactQuery?.matches ?? false)
  onMount(() => {
    const on = () => setCompact(compactQuery!.matches)
    compactQuery?.addEventListener("change", on)
    onCleanup(() => compactQuery?.removeEventListener("change", on))
  })
  let sidebarPanel: PanelContextValue | undefined
  const [sidePanel, setSidePanel] = createSignal<PanelContextValue | undefined>()
  const [layout, setLayout] = createSignal<ContextValue | undefined>()
  let groupWidth = 0
  const watchGroup = (el: Element) => {
    if (!(el instanceof HTMLElement)) return
    const measure = () => {
      groupWidth = el.getBoundingClientRect().width
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
  const sideChat = () => {
    const id = CHAT_PATH.exec(location.pathname)?.[1]
    return id && id !== "new" ? decodeURIComponent(id) : null
  }
  const sideOpen = () => {
    const id = sideChat()
    return id !== null && sidecarOpen(id)
  }
  const closeSide = () => {
    const id = sideChat()
    if (id) closeSidecar(id)
  }
  const overlaidSide = () => (compact() && sideOpen() ? sideChat() : null)
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
      if (overlaidSide()) closeSide()
      else setDrawer(false)
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
      else if (action === "close-sidecar") closeSide()
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
    const path = location.pathname
    if (prev !== undefined && prev !== path && narrow()) setDrawer(false)
    return path
  })
  useKatCommands({ toggleSidebar: toggle })
  const owner = getOwner()
  onMount(() => {
    void import("../commands/hotkeys").then((m) => runWithOwner(owner, () => m.bindCommandHotkeys()))
  })
  onMount(() => {
    if (sideOpen()) void loadSidecar()
    whenIdle(() => {
      void SettingsDialog.preload().catch(() => {})
      setTimeout(() => void import("../settings/catalog").then((m) => m.prefetchCatalog()), 3000)
    })
  })
  createEffect(() => {
    if (!richLoaded()) return
    for (const load of idlePreloads) load()
  })
  onMount(() => onCleanup(watchHold()))
  onMount(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      preloadPalette()
      preloadSearch()
      void HintLayer.preload()
      window.removeEventListener("keydown", on, true)
    }
    window.addEventListener("keydown", on, true)
    onCleanup(() => window.removeEventListener("keydown", on, true))
  })
  const sidebar = () => <Sidebar section={sectionOf(location.pathname)} collapsed={closed()} onToggle={toggle} />
  const dockedSide = () => (compact() || !sideOpen() ? null : sideChat())
  createEffect(
    on(dockedSide, (docked) => {
      requestAnimationFrame(() => {
        if (!layout()) return
        const sizes = layout()!.sizes()
        const index = sizes.length - 1
        if (index < 1) return
        const want = docked ? readWidth(INFO) : 0
        setColumnWidth(index, want)
      })
    }),
  )
  onMount(() => {
    let frame = 0
    let last = window.innerWidth
    const on = () => {
      if (window.innerWidth === last) return
      last = window.innerWidth
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const side = sidePanel()
          const fitted = fitWidths(
            window.innerWidth,
            sidebarPanel && !sidebarPanel.collapsed() ? readWidth(SIDEBAR) : 0,
            side && !side.collapsed() ? readWidth(INFO) : 0,
          )
          if (sidebarPanel && !sidebarPanel.collapsed()) sidebarPanel.resize(`${fitted.sidebar}px`)
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
        class="sidebar-shell relative flex h-dvh overflow-hidden bg-[var(--sidebar)]"
        data-component="app-shell"
        data-section={sectionOf(location.pathname) ?? undefined}
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
            const fitted = fitWidths(
              window.innerWidth,
              narrow() ? 0 : collapsed() ? 0 : readWidth(SIDEBAR),
              compact() ? 0 : dockedSide() ? readWidth(INFO) : 0,
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
                    <Show when={sectionOf(location.pathname) === "chat"}>
                      <TopBar pathname={location.pathname} sidebarOpen={!closed()} onToggleSidebar={toggle} />
                    </Show>
                    <Show when={closed() && sectionOf(location.pathname) !== "chat"}>
                      <SidebarToggle open={false} onToggle={toggle} class="main-sidebar-toggle" />
                    </Show>
                    <div
                      class="main-row relative flex min-h-0 min-w-0 flex-1"
                      data-component="main-row"
                      data-top={sectionOf(location.pathname) === "chat" ? undefined : ""}
                    >
                      <div
                        class="main-panel relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
                        data-component="main-panel"
                        ref={watchPanel}
                      >
                        <div
                          class="flex min-w-0 flex-1 flex-col"
                          style={{
                            "padding-right": sideChat() !== null && cardBeside() ? `${CARD_WIDTH + 24}px` : undefined,
                          }}
                        >
                          <Suspense fallback={<PageSkeleton />}>{props.children}</Suspense>
                        </div>
                        <Show when={cardShown() ? sideChat() : null} keyed>
                          {(id) => (
                            <div
                              class="absolute top-2 right-3 z-30 flex max-h-[calc(100%-16px)] flex-col"
                              style={{ width: `${CARD_WIDTH}px` }}
                            >
                              <Suspense>
                                <ChatCard chatId={id} />
                              </Suspense>
                            </div>
                          )}
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
                    onHandleDragEnd={() => saveWidth(INFO, "kiko-sidecar-panel")}
                    onKeyUp={() => saveWidth(INFO, "kiko-sidecar-panel")}
                    onDblClick={() => {
                      const want = defaultWidth(INFO, window.innerWidth)
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
                    initialSize={
                      fitWidths(
                        window.innerWidth,
                        collapsed() ? 0 : readWidth(SIDEBAR),
                        dockedSide() ? readWidth(INFO) : 0,
                      ).info / window.innerWidth
                    }
                    minSize={`${INFO.min}px`}
                    maxSize={`${INFO.max}px`}
                    collapsible
                    collapsedSize={0}
                    onCollapse={() => dockedSide() && closeSide()}
                  >
                    <GrabPanel onGrab={setSidePanel} />
                    <Show when={dockedSide()} keyed>
                      {(chatId) => (
                        <Suspense>
                          <Sidecar chatId={chatId} />
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
              <div
                class="drawer-scrim sidecar-scrim"
                data-component="sidecar-scrim"
                aria-hidden="true"
                onPointerDown={closeSide}
              />
              <div class="sidecar-overlay" data-component="sidecar-overlay">
                <Suspense>
                  <Sidecar chatId={chatId} />
                </Suspense>
              </div>
            </>
          )}
        </Show>
        <Palette />
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
        <Show when={settingsSection()}>
          <SettingsDialog />
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
