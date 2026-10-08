import { HugeIcon } from "@kiko/ui/huge-icon"
import { type Glyph, MonitorIcon, MoonIcon, SunIcon } from "@kiko/ui/icons"
import { For, Show, createEffect, createSignal } from "solid-js"
import { Bird } from "../mascot/bird"
import { appearanceOf } from "./apply"
import { BUILT_IN_THEMES } from "./builtins"
import { chooseTheme, hasLook, look, lookSynced, saveLook, updateLook } from "./live"
import { MODES, type Mode } from "./look"
import { DEFAULT_CARD, ThemeOrb, previewOf, themeCard } from "./theme-preview"

/*
 * The first screen after sign-up: pick an appearance and a theme before the app opens, the
 * way kat asks. It shows only once the server has said this person has no look yet, so a
 * new device never asks again. Every pick applies at once, so the preview is the app itself.
 */

const SEEN = "kiko:first-look"

const MODE_ICON: Record<Mode, Glyph> = { system: MonitorIcon, light: SunIcon, dark: MoonIcon }
const MODE_LABEL: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" }
const CARDS = [DEFAULT_CARD, ...BUILT_IN_THEMES.map(themeCard)]

/** The appearance, then t3code's themes as orbs in the appearance on screen. Every pick applies at once. */
function QuickPicker() {
  const shown = () => appearanceOf(look().mode)
  return (
    <div class="flex flex-col gap-5" data-component="look-picker">
      <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Appearance">
        <For each={MODES}>
          {(mode) => (
            <button
              type="button"
              role="radio"
              aria-checked={look().mode === mode}
              data-mode={mode}
              class="flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] text-muted outline-none hover:bg-[var(--hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:bg-[var(--selected-bg)] aria-checked:text-text"
              onClick={() => updateLook({ mode })}
            >
              <HugeIcon icon={MODE_ICON[mode]} size={15} />
              {MODE_LABEL[mode]}
            </button>
          )}
        </For>
      </div>
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
        <For each={CARDS}>
          {(card) => (
            <button
              type="button"
              role="radio"
              aria-checked={look()[shown()] === card.id}
              data-theme-id={card.id ?? "default"}
              class="group flex w-[76px] flex-col items-center gap-1.5 rounded-xl p-1.5 outline-none hover:bg-[var(--hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:bg-[var(--selected-bg)]"
              onClick={() => chooseTheme(card.id)}
            >
              <ThemeOrb colors={previewOf(card, shown())} mode={shown()} />
              <span class="text-xs text-muted group-aria-checked:text-text">{card.label}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN) === "1"
  } catch {
    return false
  }
}

export default function FirstLook() {
  // Latched: the first pick saves a look, and the screen must stay up until continue.
  const [open, setOpen] = createSignal(false)
  createEffect(() => {
    if (lookSynced() && !hasLook() && !seen()) setOpen(true)
  })
  const finish = () => {
    // Saving the default too means another device knows the choice was made.
    saveLook(look())
    try {
      localStorage.setItem(SEEN, "1")
    } catch {
      // the saved look is enough on its own to keep this closed.
    }
    setOpen(false)
  }

  return (
    <Show when={open()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-bg px-4 py-10" data-component="first-look" role="dialog" aria-modal="true" aria-labelledby="first-look-title">
        <div class="flex w-full max-w-[560px] flex-col items-center gap-7">
          <Bird slug="kiko" size={88} state="wave" />
          <div class="flex flex-col items-center gap-1.5 text-center">
            <h1 id="first-look-title" class="text-2xl font-semibold text-text">Make Kiko yours</h1>
            <p class="text-sm text-muted">You can change this any time in Settings.</p>
          </div>
          <div class="w-full rounded-2xl bg-[var(--card)] [box-shadow:var(--card-shadow)] p-4">
            <QuickPicker />
          </div>
          <div class="flex w-full flex-col gap-1.5 rounded-2xl bg-[var(--bg-sidebar)] p-4 text-sm" aria-hidden="true">
            <div class="self-end rounded-[18px] bg-[var(--user-bubble)] px-3 py-1.5 text-[var(--user-bubble-text)]">Plan my Tokyo trip</div>
            <div class="flex items-end gap-2">
              <Bird slug="kiko" size={26} />
              <div class="rounded-[18px] bg-[var(--assistant-bubble)] px-3 py-1.5 text-text">
                Love that. Asking <span class="font-medium text-[var(--accent)]">@scout</span> for flights
              </div>
            </div>
          </div>
          <button
            type="button"
            class="h-11 w-full max-w-72 rounded-xl bg-[var(--accent-fill)] text-sm font-medium text-[var(--on-accent)] outline-none hover:bg-[var(--accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            data-action="finish-first-look"
            onClick={finish}
          >
            Continue
          </button>
        </div>
      </div>
    </Show>
  )
}
