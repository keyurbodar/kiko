import { useLocation } from "@solidjs/router";
import {
  I18nProvider,
  pluralCategory,
  pluralKey,
  type UiI18n,
} from "@kiko/ui/context/i18n";
import { dict } from "@kiko/ui/i18n/en";
import { ToastV2 } from "@kiko/ui/v2/toast-v2";
import { birdPickerSlug } from "../mascot/picker-state";
import { createEffect, createSignal, getOwner, lazy, onCleanup, onMount, runWithOwner, Show, Suspense, type ParentProps } from "solid-js";
import { infoOpen, loadInfoPanel } from "../chat/info/state";
import { useKatCommands } from "../commands/use-kat-commands";
import { runCommand, useCommands } from "../commands/registry";
import { snapshotAfterRoute } from "../lib/snapshot";
import { Palette, preloadPalette } from "../palette";
import { preloadSearch, SearchOverlay, searchScope } from "../search/state";
import { hintsShown, watchHold } from "../commands/hints";
// The shortcut pills load on the first modifier press, with the palette, so the hold shows them at once.
const HintLayer = lazy(() => import("../commands/HintLayer"));
import { Sidebar, SidebarToggle } from "../sidebar";
import { drawerOpen, setDrawerOpen } from "./drawer";
import { sectionOf } from "./sections";
import { TopBar } from "./top-bar";

const fill = (
  text: string,
  params?: Record<string, string | number | boolean>,
) =>
  text.replace(/{{\s*([^}]+?)\s*}}/g, (_, key: string) =>
    String(params?.[key] ?? ""),
  );

// The one dictionary is already lowercase, so the shell just looks keys up.
const i18n: UiI18n = {
  locale: () => "en",
  t: (key, params) => fill(dict[key] ?? String(key), params),
  plural: (key, count, params) =>
    i18n.t(pluralKey(key, pluralCategory("en", count)) as never, {
      ...params,
      count,
    }),
};

// The info panel loads on the first open, or on idle after the first paint. The chat route does not carry it.
const InfoPanel = lazy(loadInfoPanel);
// The first-run look screen and the bird picker each load on their own, off the first paint.
const FirstLook = lazy(() => import("../theme/first-look"));
const BirdPicker = lazy(() => import("../mascot/picker"));
const CHAT_PATH = /^\/chat\/([^/]+)$/;

const KEY = "kiko:sidebar-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {}
}

/*
 * The frame around every screen: the sidebar column, then the main column with the top bar
 * over a rounded panel. In frost the shell is glass over the scene `kat.css` paints on the
 * body, and the panel is a second, denser pane. The shell is the router's root, so it never
 * remounts on a route change and the swap is instant.
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
  const closed = () => (narrow() ? !drawer() : collapsed());
  const setAndSave = (value: boolean) => {
    if (narrow()) return setDrawer(!value);
    setCollapsed(value);
    writeCollapsed(value);
  };
  const toggle = () => setAndSave(!closed());
  // Going anywhere closes the drawer, so picking a chat shows it.
  createEffect((prev: string | undefined) => {
    const path = location.pathname;
    if (prev !== undefined && prev !== path && narrow()) setDrawer(false);
    // The startup screen is taken once after each route change, not on a timer.
    if (prev !== path) snapshotAfterRoute();
    return path;
  });
  /** The chat the panel describes: the one named by the URL. */
  const infoChat = () => {
    const id = CHAT_PATH.exec(location.pathname)?.[1];
    return id && id !== "new" ? decodeURIComponent(id) : null;
  };
  useKatCommands({ toggleSidebar: toggle });
  if (import.meta.env.DEV) {
    useCommands([
      {
        id: "chat.dev-presence-demo",
        title: "dev: play the presence demo",
        group: "chat",
        icon: "chat",
        when: () => !!infoChat() || CHAT_PATH.test(location.pathname),
        run: () => void import("../dev/presence-demo").then((m) => m.playPresenceDemo()),
      },
      {
        id: "chat.dev-fake-chat",
        title: "dev: new chat with scripted agents",
        group: "chat",
        icon: "plus",
        run: () => void import("../dev/presence-demo").then((m) => m.newFakeChat(() => runCommand("chat.new"))),
      },
    ]);
  }
  // The hotkey library loads right after first paint. Shortcuts are keyboard only, so nothing waits on it.
  const owner = getOwner();
  onMount(() => {
    void import("../commands/hotkeys").then((m) => runWithOwner(owner, () => m.bindCommandHotkeys()));
  });
  onMount(() => {
    const idle = (globalThis as { requestIdleCallback?: (run: () => void) => number }).requestIdleCallback;
    if (infoOpen()) void loadInfoPanel();
    else if (idle) idle(() => void loadInfoPanel());
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
  return (
    <I18nProvider value={i18n}>
      <div
        class="sidebar-shell flex h-dvh overflow-hidden bg-[var(--bg-sidebar)]"
        data-component="app-shell"
        data-section={sectionOf(location.pathname) ?? undefined}
      >
        <Sidebar
          section={sectionOf(location.pathname)}
          collapsed={closed()}
          onCollapsedChange={setAndSave}
          onToggle={toggle}
        />
        <Show when={narrow() && drawer()}>
          <div
            class="drawer-scrim"
            data-component="drawer-scrim"
            aria-hidden="true"
            onPointerDown={() => setDrawer(false)}
          />
        </Show>
        {/* The top bar sits on the shell, and the panel is a rounded pane under it. A section
            without a top bar (settings) gets the panel from the top, and the sidebar button
            floats over its corner while the sidebar is shut. */}
        <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden" data-component="main-column">
          <TopBar sidebarOpen={!closed()} onToggleSidebar={toggle} />
          <Show when={closed() && sectionOf(location.pathname) !== "chat"}>
            <SidebarToggle open={false} onToggle={toggle} class="main-sidebar-toggle" />
          </Show>
          <div
            class="main-row @container/main relative flex min-h-0 min-w-0 flex-1"
            data-component="main-row"
            data-top={sectionOf(location.pathname) === "chat" ? undefined : ""}
          >
            <div class="main-panel relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-component="main-panel">
              <div class="flex min-w-0 flex-1 flex-col">
                {props.children}
              </div>
            </div>
            {/* The info panel is a second pane beside the chat. Message search sits over both. */}
            <Show when={infoOpen() ? infoChat() : null}>
              {(chatId) => (
                <Suspense>
                  <InfoPanel chatId={chatId()} />
                </Suspense>
              )}
            </Show>
            <Show when={searchScope()}>
              <Suspense>
                <SearchOverlay />
              </Suspense>
            </Show>
          </div>
        </main>
        <Palette />
        <Show when={hintsShown()}>
          <Suspense>
            <HintLayer />
          </Suspense>
        </Show>
        <ToastV2.Region />
        <Suspense>
          <FirstLook />
        </Suspense>
        <Show when={birdPickerSlug()}>
          <Suspense>
            <BirdPicker />
          </Suspense>
        </Show>
      </div>
    </I18nProvider>
  );
}
