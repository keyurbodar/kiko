import Resizable, { type PanelContextValue } from "@corvu/resizable";
import { useLocation } from "@solidjs/router";
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
import { cardOpen, loadCard } from "../chat/side/card-state";
import { closeSidecar, loadSidecar, sidecarOpen } from "../chat/side/surfaces";
import { useKatCommands } from "../commands/use-kat-commands";
import { snapshotAfterRoute } from "../lib/snapshot";
import { Palette, preloadPalette } from "../palette";
import { preloadSearch, SearchOverlay, searchScope } from "../search/state";
import { hintsShown, watchHold } from "../commands/hints";
// The shortcut pills load on the first modifier press, with the palette, so the hold shows them at once.
const HintLayer = lazy(() => import("../commands/HintLayer"));
import { Sidebar, SidebarToggle } from "../sidebar";
import { drawerOpen, setDrawerOpen } from "./drawer";
import { swipeAction, swipeRegion, type SwipeRegion } from "./edge-swipe";
import { sectionOf } from "./sections";
import { TopBar } from "./top-bar";
import { CHAT_MIN, INFO, initialSizes, readWidth, saveWidth, SIDEBAR } from "./widths";

const fill = (
  text: string,
  params?: Record<string, string | number | boolean>,
) =>
  text.replace(/{{\s*([^}]+?)\s*}}/g, (_, key: string) =>
    String(params?.[key] ?? ""),
  );

// The one dictionary holds the final wording, so the shell just looks keys up.
const i18n: UiI18n = {
  locale: () => "en",
  t: (key, params) => fill(dict[key] ?? String(key), params),
  plural: (key, count, params) =>
    i18n.t(pluralKey(key, pluralCategory("en", count)) as never, {
      ...params,
      count,
    }),
};

// The sidecar loads on the first open, or on idle after the first paint. The chat route does not carry it.
const Sidecar = lazy(loadSidecar);
const Card = lazy(loadCard);
// The first-run look screen and the avatar picker each load on their own, off the first paint.
const AvatarPicker = lazy(() => import("../avatar/picker"));
const CHAT_PATH = /^\/chat\/([^/]+)$/;

const KEY = "kiko:sidebar-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Hands the enclosing Corvu panel's controls to the shell. */
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

/*
 * The frame around every screen: the sidebar column, then the main column with the top bar
 * over a rounded panel. The shell is the router's root, so it never remounts on a route
 * change and the swap is instant.
 *
 * `sidebar-shell` is the flex row the sidebar's stylesheet is scoped under.
 */
export function Shell(props: ParentProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = createSignal(readCollapsed());
  // Below 768 px the sidebar is a drawer over the transcript. It starts closed on every load and
  // is never saved, so the saved wide-screen preference does not bury the chat on a phone.
  const narrowQuery = typeof matchMedia === "function" ? matchMedia("(width < 768px)") : undefined;
  const [narrow, setNarrow] = createSignal(narrowQuery?.matches ?? false);
  // The right panel sits beside the chat only where the chat keeps its 360 px. Below that it covers the chat.
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
  // Keyboard intent for focus rings: a real navigation key turns rings on, a pointer turns them
  // off. Modifiers alone do not count, so pressing Cmd for a shortcut never rings the clicked row.
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
    if (!(narrow() && drawer())) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setDrawer(false);
    };
    window.addEventListener("keydown", on);
    onCleanup(() => window.removeEventListener("keydown", on));
  });
  // Phone swipes for the drawer and the sidecar (edge-swipe.ts). Touch events, not pointer
  // events: a pointer is cancelled once the browser starts panning, and the end is what decides.
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
  // Going anywhere closes the drawer, so picking a chat shows it.
  createEffect((prev: string | undefined) => {
    const path = location.pathname;
    if (prev !== undefined && prev !== path && narrow()) setDrawer(false);
    // The startup screen is taken once after each route change, not on a timer.
    if (prev !== path) snapshotAfterRoute();
    return path;
  });
  /** The chat the sidecar shows: the one named by the URL. */
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
  // The hotkey library loads right after first paint. Shortcuts are keyboard only, so nothing waits on it.
  const owner = getOwner();
  onMount(() => {
    void import("../commands/hotkeys").then((m) => runWithOwner(owner, () => m.bindCommandHotkeys()));
  });
  onMount(() => {
    const idle = (globalThis as { requestIdleCallback?: (run: () => void) => number }).requestIdleCallback;
    if (sideOpen()) void loadSidecar();
    else if (idle) idle(() => void loadSidecar());
  });
  onMount(() => onCleanup(watchHold()));
  // Preload tier 3 on the first modifier key so the palette opens in one frame.
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
  // The docked column is always in the layout and opens and closes as the sidebar does, so Corvu
  // moves the width between it and the chat and the other columns stay put.
  createEffect(() => {
    const panel = sidePanel();
    if (!panel) return;
    if (dockedSide()) {
      if (!panel.collapsed()) return;
      panel.expand();
      panel.resize(`${readWidth(INFO)}px`);
    } else if (!panel.collapsed()) panel.collapse();
  });
  // Corvu keeps each column a share of the window, so a window resize would carry a column past its
  // limits. The saved widths are put back, and Corvu clamps them against the chat's floor.
  onMount(() => {
    let frame = 0;
    let last = window.innerWidth;
    const on = () => {
      if (window.innerWidth === last) return;
      last = window.innerWidth;
      cancelAnimationFrame(frame);
      // Corvu learns the new window width from a ResizeObserver, which runs after the first frame.
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
        class="sidebar-shell relative flex h-dvh overflow-hidden bg-[var(--shell-bg)]"
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
                  />
                </Show>
                <Resizable.Panel class="shell-panel" data-component="chat-panel" initialSize={sizes.chat} minSize={`${CHAT_MIN}px`}>
                  {/* The top bar sits on the shell, and the panel is a pane under it. A section
                      without a top bar (settings) gets the panel from the top, and the sidebar button
                      floats over its corner while the sidebar is shut. */}
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
                      <div class="main-panel relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-component="main-panel">
                        <div class="flex min-w-0 flex-1 flex-col">
                          {props.children}
                        </div>
                        <Show when={cardOpen() ? sideChat() : null} keyed>
                          {(id) => (
                            <Suspense>
                              <Card chatId={id} />
                            </Suspense>
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
