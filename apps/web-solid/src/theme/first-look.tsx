import { Show, createEffect, createSignal } from "solid-js"
import { Bird } from "../mascot/bird"
import { hasLook, look, lookSynced, saveLook } from "./live"
import { LookPicker } from "./look-picker"

/*
 * The first screen after sign-up: pick an appearance and a color before the app opens, the
 * way kat asks. It shows only once the server has said this person has no look yet, so a
 * new device never asks again. Every pick applies at once, so the preview is the app itself.
 */

const SEEN = "kiko:first-look"

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
            <h1 id="first-look-title" class="text-2xl font-semibold text-text">make kiko yours</h1>
            <p class="text-sm text-muted">pick how it looks. you can change it any time in settings or with the command palette.</p>
          </div>
          <div class="w-full rounded-2xl bg-[var(--bg-subtle)] p-4">
            <LookPicker look={look()} onChange={saveLook} />
          </div>
          <div class="flex w-full flex-col gap-1.5 rounded-2xl bg-[var(--bg-sidebar)] p-4 text-sm" aria-hidden="true">
            <div class="self-end rounded-[18px] bg-[var(--user-bubble)] px-3 py-1.5 text-[var(--user-bubble-text)]">plan my tokyo trip</div>
            <div class="flex items-end gap-2">
              <Bird slug="kiko" size={26} />
              <div class="rounded-[18px] bg-[var(--assistant-bubble)] px-3 py-1.5 text-text">
                love that. asking <span class="font-medium text-[var(--accent)]">@scout</span> for flights
              </div>
            </div>
          </div>
          <button
            type="button"
            class="h-11 w-full max-w-72 rounded-xl bg-[var(--accent-fill)] text-sm font-medium text-[var(--on-accent)] outline-none hover:bg-[var(--accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            data-action="finish-first-look"
            onClick={finish}
          >
            continue
          </button>
        </div>
      </div>
    </Show>
  )
}
