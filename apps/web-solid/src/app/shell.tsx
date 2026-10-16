import Resizable, { type PanelContextValue } from "@corvu/resizable";
import { useLocation, useNavigate } from "@solidjs/router";
import {
  I18nProvider,
  pluralCategory,
  pluralKey,
  type UiI18n,
} from "@kiko/ui/context/i18n";
import { dict } from "@kiko/ui/i18n/en";
import { ToastV2 } from "@kiko/ui/v2/toast-v2";
import { avatarPickerSlug } from "../avatar/picker-state";
import { createEffect, createMemo, createSignal, getOwner, lazy, onCleanup, onMount, runWithOwner, Show, Suspense, type ParentProps } from "solid-js";
import { closeSidecar, loadSidecar, sidecarOpen } from "../chat/side/surfaces";
import { preloadRoute } from "./routes";
import { preloadMessageMenu } from "../chat/ui/MessageMenu";
import { preloadModelPicker } from "../settings/model-picker";
import { preloadMessageSearch } from "../commands/message-search";

import { richLoaded } from "../composer/rich/loaded";
import { CARD_WIDTH, cardBeside, cardShown, loadCard, setCardRoom } from "../chat/side/card-state";
import { useKatCommands } from "../commands/use-kat-commands";
import { setGo } from "../lib/errors";
import { snapshotAfterRoute } from "../lib/snapshot";
import { Palette, preloadPalette } from "../palette";
import { botPickerOpen } from "../chat/bot-picker-state";
import { preloadSearch, SearchOverlay, searchScope } from "../search/state";
import { hintsShown, watchHold } from "../commands/hints";
const HintLayer = lazy(() => import("../commands/HintLayer"));
import { Sidebar, SidebarToggle } from "../sidebar";
import { drawerOpen, setDrawerOpen } from "./drawer";
import { swipeAction, swipeRegion, type SwipeRegion } from "./edge-swipe";
import { sectionOf } from "./sections";
import { TopBar } from "./top-bar";
import { VersionBanner } from "./version-banner";
import { CHAT_MIN, INFO, initialSizes, readWidth, resetWidth, saveWidth, SIDEBAR } from "./widths";

/** Lazy menu and picker chunks, warmed once the rich editor is in, so no first right click or open waits on the network. */
const idlePreloads = [preloadMessageMenu, preloadModelPicker, preloadMessageSearch];

const fill = (
  text: string,
  params?: Record<string, string | number | boolean>,
) =>
  text.replace(/{{\s*([^}]+?)\s*}}/g, (_, key: string) =>
    String(params?.[key] ?? ""),
  );

const i18n: UiI18n = {
  locale: () => "en",
  t: (key, params) => fill(dict[key] ?? String(key), params),
  plural: (key, count, params) =>
    i18n.t(pluralKey(key, pluralCategory("en", count)) as never, {
      ...params,
      count,
    }),
};

const Sidecar = lazy(loadSidecar);
const ChatCard = lazy(loadCard);
const watchPanel = (el: HTMLElement) => {
  const observer = new ResizeObserver(([entry]) => setCardRoom(entry?.contentRect.width ?? 0));
  observer.observe(el);
  onCleanup(() => observer.disconnect());
};
const AvatarPicker = lazy(() => import("../avatar/picker"));
const BotPicker = lazy(() => import("../chat/bot-picker"));
const CHAT_PATH = /^\/chat\/([^/]+)$/;

const KEY = "kiko:sidebar-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function GrabPanel(props: { onGrab: (panel: PanelContextValue | undefined) => void }) {
  props.onGrab(Resizable.usePanelContext())
  onCleanup(() => props.onGrab(undefined))
  return null
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {}
}

export function Shell(props: ParentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  setGo(navigate);
  const [collapsed, setCollapsed] = createSignal(readCollapsed());
  const narrowQuery = typeof matchMedia === "function" ? matchMedia("(width < 768px)") : undefined;
  const [narrow, setNarrow] = createSignal(narrowQuery?.matches ?? false);
  const compactQuery = typeof matchMedia === "function" ? matchMedia("(width < 960px)") : undefined
  const [compact, setCompact] = createSignal(compactQuery?.matches ?? false)
  onMount(() => {
    const on = () => setCompact(compactQuery!.matches)
    compactQuery?.addEventListener("change", on)
    onCleanup(() => compactQuery?.removeEventListener("change", on))
  })
  let sidebarPanel: PanelContextValue | undefined
  const [sidePanel, setSidePanel] = createSignal<PanelContextValue | undefined>();
  const drawer = drawerOpen;
  const setDrawer = setDrawerOpen;
  onMount(() => {
    const root = document.documentElement;
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.metaKey || e.ctrlKey) return;
      root.dataset.input = "keys";
    };
    const pointer = () => delete root.dataset.input;
    window.addEventListener("keydown", keys, true);
    window.addEventListener("pointerdown", pointer, true);
    onCleanup(() => {
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("pointerdown", pointer, true);
    });
  });
  onMount(() => {
    const on = () => {
      setNarrow(narrowQuery!.matches);
      setDrawer(false);
    };
    narrowQuery?.addEventListener("change", on);
    onCleanup(() => narrowQuery?.removeEventListener("change", on));
  });
  createEffect(() => {
    if (!(narrow() && drawer()) && !overlaidSide()) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (overlaidSide()) closeSide();
      else setDrawer(false);
    };
    window.addEventListener("keydown", on);
    onCleanup(() => window.removeEventListener("keydown", on));
  });
  createEffect(() => {
    if (!narrow()) return;
    let start: { x: number; y: number; region: SwipeRegion } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, region: swipeRegion(e.target, t.clientX) } : null;
    };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const action = swipeAction({ drawer: drawer(), sidecar: sideOpen() }, start.region, t.clientX - start.x, t.clientY - start.y);
      start = null;
      if (action === "open-drawer") setDrawer(true);
      else if (action === "close-drawer") setDrawer(false);
      else if (action === "close-sidecar") closeSide();
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    onCleanup(() => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
    });
  });
  const closed = () => (narrow() ? !drawer() : collapsed());
  const setAndSave = (value: boolean) => {
    setCollapsed(value);
    writeCollapsed(value);
  };
  const toggle = () => {
    if (narrow()) return setDrawer(!drawer());
    if (!sidebarPanel) return;
    if (sidebarPanel.collapsed()) {
      sidebarPanel.expand();
      sidebarPanel.resize(`${readWidth(SIDEBAR)}px`);
    } else sidebarPanel.collapse();
  };
  createEffect((prev: string | undefined) => {
    const path = location.pathname;
    if (prev !== undefined && prev !== path && narrow()) setDrawer(false);
    if (prev !== path) snapshotAfterRoute();
    return path;
  });
  const sideChat = () => {
    const id = CHAT_PATH.exec(location.pathname)?.[1];
    return id && id !== "new" ? decodeURIComponent(id) : null;
  };
  const sideOpen = () => {
    const id = sideChat();
    return id !== null && sidecarOpen(id);
  };
  const closeSide = () => {
    const id = sideChat();
    if (id) closeSidecar(id);
  };
  useKatCommands({ toggleSidebar: toggle });
  const owner = getOwner();
  onMount(() => {
    void import("../commands/hotkeys").then((m) => runWithOwner(owner, () => m.bindCommandHotkeys()));
  });
  onMount(() => {
    const idle = (globalThis as { requestIdleCallback?: (run: () => void) => number }).requestIdleCallback;
    if (sideOpen()) void loadSidecar();
    const warm = () => {
      preloadRoute("/chat");
      setTimeout(() => void import("../settings/catalog").then((m) => m.prefetchCatalog()), 3000);
    };
    if (idle) idle(warm);
    else setTimeout(warm, 300);
  });
  // After the composer's rich editor has loaded, so the settings download never races it.
  createEffect(() => {
    if (!richLoaded()) return;
    preloadRoute("/settings");
    for (const load of idlePreloads) load();
  });
  onMount(() => onCleanup(watchHold()));
  onMount(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      preloadPalette();
      preloadSearch();
      void HintLayer.preload();
      window.removeEventListener("keydown", on, true);
    };
    window.addEventListener("keydown", on, true);
    onCleanup(() => window.removeEventListener("keydown", on, true));
  });
  const sidebar = createMemo(() => (
    <Sidebar section={sectionOf(location.pathname)} collapsed={closed()} onToggle={toggle} />
  ));
  const dockedSide = () => (compact() || !sideOpen() ? null : sideChat());
  createEffect(() => {
    const panel = sidePanel();
    if (!panel) return;
    if (dockedSide()) {
      if (!panel.collapsed()) return;
      panel.expand();
      panel.resize(`${readWidth(INFO)}px`);
    } else if (!panel.collapsed()) panel.collapse();
  });
  onMount(() => {
    let frame = 0;
    let last = window.innerWidth;
    const on = () => {
      if (window.innerWidth === last) return;
      last = window.innerWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (sidebarPanel && !sidebarPanel.collapsed()) sidebarPanel.resize(`${readWidth(SIDEBAR)}px`);
          const side = sidePanel();
          if (side && !side.collapsed()) side.resize(`${readWidth(INFO)}px`);
        });
      });
    };
    window.addEventListener("resize", on);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", on);
    });
  });
  const overlaidSide = () => (compact() && sideOpen() ? sideChat() : null);
  return (
    <I18nProvider value={i18n}>
      <div
        class="sidebar-shell relative flex h-dvh overflow-hidden bg-[var(--sidebar)]"
        data-component="app-shell"
        data-section={sectionOf(location.pathname) ?? undefined}
      >
        <VersionBanner />
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
            const sizes = initialSizes(window.innerWidth, narrow() ? null : collapsed() ? 0 : readWidth(SIDEBAR), compact() ? null : dockedSide() ? readWidth(INFO) : 0);
            return (
              <Resizable class="min-w-0 flex-1" keyboardDelta="16px" data-component="app-panels">
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
                <Resizable.Panel class="shell-panel" data-component="chat-panel" initialSize={sizes.chat} minSize={`${CHAT_MIN}px`}>

                  <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden" data-component="main-column">
                    <TopBar sidebarOpen={!closed()} onToggleSidebar={toggle} />
                    <Show when={closed() && sectionOf(location.pathname) !== "chat"}>
                      <SidebarToggle open={false} onToggle={toggle} class="main-sidebar-toggle" />
                    </Show>
                    <div
                      class="main-row relative flex min-h-0 min-w-0 flex-1"
                      data-component="main-row"
                      data-top={sectionOf(location.pathname) === "chat" ? undefined : ""}
                    >
                      <div class="main-panel relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-component="main-panel" ref={watchPanel}>
                        <div class="flex min-w-0 flex-1 flex-col" style={{ "padding-right": sideChat() !== null && cardBeside() ? `${CARD_WIDTH + 24}px` : undefined }}>
                          {props.children}
                        </div>
                        <Show when={cardShown() ? sideChat() : null} keyed>
                          {(id) => (
                            <div class="absolute top-2 right-3 z-30 flex max-h-[calc(100%-16px)] flex-col" style={{ width: `${CARD_WIDTH}px` }}>
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
                  <Resizable.Handle
                    class="resize-handle"
                    data-component="sidecar-resize"
                    aria-label="Resize side panel"
                    altKey={false}
                    disabled={!dockedSide()}
                    onHandleDragEnd={() => saveWidth(INFO, "kiko-sidecar-panel")}
                    onKeyUp={() => saveWidth(INFO, "kiko-sidecar-panel")}
                    onDblClick={() => resetWidth(INFO, sidePanel())}
                  />
                  <Resizable.Panel
                    panelId="kiko-sidecar-panel"
                    class="shell-panel"
                    data-component="sidecar-column"
                    initialSize={sizes.info}
                    minSize={`${INFO.min}px`}
                    maxSize={`${INFO.max}px`}
                    collapsible
                    collapsedSize={0}
                    onCollapse={() => dockedSide() && closeSide()}
                  >
                    <GrabPanel onGrab={setSidePanel} />
                    <Show when={dockedSide()}>
                      {(chatId) => (
                        <Suspense>
                          <Sidecar chatId={chatId()} />
                        </Suspense>
                      )}
                    </Show>
                  </Resizable.Panel>
                </Show>
              </Resizable>
            );
          }}
        </Show>
        <Show when={overlaidSide()}>
          {(chatId) => (
            <>
              <div class="drawer-scrim sidecar-scrim" data-component="sidecar-scrim" aria-hidden="true" onPointerDown={closeSide} />
              <div class="sidecar-overlay" data-component="sidecar-overlay">
                <Suspense>
                  <Sidecar chatId={chatId()} />
                </Suspense>
              </div>
            </>
          )}
        </Show>
        <Palette />
        <Show when={botPickerOpen()}>
          <Suspense>
            <BotPicker />
          </Suspense>
        </Show>
        <Show when={hintsShown()}>
          <Suspense>
            <HintLayer />
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
  );
}
