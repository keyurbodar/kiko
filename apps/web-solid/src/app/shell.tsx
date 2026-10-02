import { useLocation } from "@solidjs/router";
import {
  I18nProvider,
  pluralCategory,
  pluralKey,
  type UiI18n,
} from "@kiko/ui/context/i18n";
import { dict } from "@kiko/ui/i18n/en";
import { ToastV2 } from "@kiko/ui/v2/toast-v2";
import { createSignal, onCleanup, onMount, type ParentProps } from "solid-js";
import { bindCommandHotkeys } from "../commands/hotkeys";
import { useKatCommands } from "../commands/use-kat-commands";
import { Palette, preloadPalette } from "../palette";
import { Sidebar } from "../sidebar";
import { Rail } from "./rail";
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
 * The kat frame around every screen: rail, sidebar column, then the main panel
 * with its 32 px top-left corner and the top bar. The shell is the router's
 * root, so it never remounts on a route change and the swap is instant.
 *
 * `sidebar-shell` is the flex row the sidebar's stylesheet is scoped under.
 */
export function Shell(props: ParentProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = createSignal(readCollapsed());
  const setAndSave = (value: boolean) => {
    setCollapsed(value);
    writeCollapsed(value);
  };
  const toggle = () => setAndSave(!collapsed());
  useKatCommands({ toggleSidebar: toggle });
  bindCommandHotkeys();
  // Preload tier 3 on the first modifier key so the palette opens in one frame.
  onMount(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      preloadPalette();
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
        <Rail collapsed={collapsed()} onToggleSidebar={toggle} />
        <Sidebar
          section={sectionOf(location.pathname)}
          collapsed={collapsed()}
          onCollapsedChange={setAndSave}
        />
        <main
          class="flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-[32px] bg-bg"
          data-component="main-panel"
        >
          <TopBar />
          {props.children}
        </main>
        <Palette />
        <ToastV2.Region />
      </div>
    </I18nProvider>
  );
}
