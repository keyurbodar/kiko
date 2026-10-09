import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { look, saveLook } from "../theme/live"
import { Bird } from "./bird"
import { KIKO } from "@kiko/protocol"
import { FLAVORS, FRIEND_IDS, OUTFITS, OUTFIT_IDS, formatBird, type BirdSpec, type BirdState } from "./birds"
import { birdFor } from "./choices"
import { birdPickerSlug, closeBirdPicker } from "./picker-state"
import { Dialog } from "../lib/dialog"
import { Button } from "../settings/kit"

/*
 * The bird picker: a flavor and what the bird wears, for one agent. The preview acts out every
 * mood the agent can be in, so a person sees the bird thinking and typing before they keep it.
 * Yuki is always the warm cream bird; only its outfit changes.
 */

const MOODS: BirdState[] = ["wave", "thinking", "typing", "working", "sending", "sleeping", "idle"]

// The pick is a filled cell with an accent edge; focus is a plain ring, and only from the keyboard.
const chip =
  "grid place-items-center rounded-xl outline-none hover:bg-[var(--btn-bg)] [:root[data-input=keys]_&]: [:root[data-input=keys]_&]: aria-checked:bg-[var(--accent-wash)] aria-checked:shadow-[inset_0_0_0_1.5px_var(--accent)]"

function Picker(props: { slug: string }) {
  const [draft, setDraft] = createSignal<BirdSpec>(birdFor(props.slug))
  const [mood, setMood] = createSignal(0)
  const timer = setInterval(() => setMood((m) => (m + 1) % MOODS.length), 1800)
  onCleanup(() => clearInterval(timer))
  const isYuki = () => props.slug === KIKO
  const set = (patch: Partial<BirdSpec>) => setDraft({ ...draft(), ...patch })
  const save = () => {
    saveLook({ ...look(), birds: { ...look().birds, [props.slug]: formatBird(draft()) } })
    closeBirdPicker()
  }
  const reset = () => {
    const { [props.slug]: _, ...rest } = look().birds
    saveLook({ ...look(), birds: rest })
    closeBirdPicker()
  }
  createEffect(() => setDraft(birdFor(props.slug)))

  return (
    <Dialog
      open
      onClose={closeBirdPicker}
      title={isYuki() ? "Yuki, the chief" : `@${props.slug}`}
      data-component="bird-picker"
      footer={
        <>
          <Button variant="ghost" class="mr-auto" onClick={reset} disabled={!look().birds[props.slug]}>
            Use its own bird
          </Button>
          <Button variant="ghost" onClick={closeBirdPicker}>
            Cancel
          </Button>
          <Button variant="primary" data-action="save-bird" onClick={save}>
            Keep this bird
          </Button>
        </>
      }
    >
      <div class="flex flex-col gap-4" data-slug={props.slug}>
        <div class="flex items-center gap-4">
          <Bird spec={draft()} state={MOODS[mood()]} size={96} alive />
          <div class="flex min-w-0 flex-col gap-1">
            <p class="text-xs text-muted">
              {FLAVORS[draft().flavor].label}
              {draft().outfit !== "none" ? ` in ${OUTFITS[draft().outfit].label.toLowerCase()}` : ""} · {MOODS[mood()]!.charAt(0).toUpperCase()}{MOODS[mood()]!.slice(1)}
            </p>
            <Show when={isYuki()}>
              <p class="text-xs text-muted">Yuki is always the warm cream Shima Enaga.</p>
            </Show>
          </div>
        </div>

        <Show when={!isYuki()}>
          <section class="flex flex-col gap-2">
            <h3 class="text-xs text-muted">Flavor</h3>
            <div class="grid grid-cols-6 gap-1" role="radiogroup" aria-label="Flavor">
              <For each={FRIEND_IDS}>
                {(f) => (
                  <button type="button" role="radio" aria-checked={draft().flavor === f} aria-label={FLAVORS[f].label} title={`${FLAVORS[f].label}, ${FLAVORS[f].vibe}`} class={`${chip} aspect-square`} onClick={() => set({ flavor: f })}>
                    <Bird spec={{ flavor: f, outfit: "none" }} size={38} />
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs text-muted">Wears</h3>
          <div class="grid grid-cols-6 gap-1" role="radiogroup" aria-label="Outfit">
            <For each={OUTFIT_IDS}>
              {(o) => (
                <button type="button" role="radio" aria-checked={draft().outfit === o} aria-label={OUTFITS[o].label} title={OUTFITS[o].label} class={`${chip} aspect-square`} onClick={() => set({ outfit: o })}>
                  <Bird spec={{ ...draft(), outfit: o }} size={38} />
                </button>
              )}
            </For>
          </div>
        </section>
      </div>
    </Dialog>
  )
}

/** Mounted once in the shell. Opens for whichever agent `openBirdPicker` names. */
export default function BirdPicker() {
  return <Show when={birdPickerSlug()}>{(slug) => <Picker slug={slug()} />}</Show>
}
