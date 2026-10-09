import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { look, saveLook } from "../theme/live"
import { Bird } from "./bird"
import { ACCESSORIES, ACCESSORY_IDS, SPECIES, SPECIES_IDS, TINTS, formatBird, type BirdSpec, type BirdState } from "./birds"
import { birdFor } from "./choices"
import { birdPickerSlug, closeBirdPicker } from "./picker-state"
import { Dialog } from "../lib/dialog"
import { Button } from "../settings/kit"

/*
 * The bird picker: species, tint and what the bird wears, for one agent. The preview acts
 * out every mood the agent can be in, so a person sees the bird thinking and typing before
 * they keep it. The kiko agent is always the kiko bird; only its tint and outfit change.
 */

const MOODS: BirdState[] = ["wave", "thinking", "typing", "working", "sending", "idle"]

// The pick is a filled cell with an accent edge; focus is a plain ring, and only from the keyboard.
const chip =
  "grid place-items-center rounded-xl outline-none hover:bg-[var(--btn-bg)] [:root[data-input=keys]_&]: [:root[data-input=keys]_&]: aria-checked:bg-[var(--accent-wash)] aria-checked:shadow-[inset_0_0_0_1.5px_var(--accent)]"

function Picker(props: { slug: string }) {
  const [draft, setDraft] = createSignal<BirdSpec>(birdFor(props.slug))
  const [mood, setMood] = createSignal(0)
  const timer = setInterval(() => setMood((m) => (m + 1) % MOODS.length), 1800)
  onCleanup(() => clearInterval(timer))
  const isKiko = () => props.slug === "kiko"
  const species = () => (isKiko() ? (["kiko"] as const) : SPECIES_IDS.filter((s) => s !== "kiko"))
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
      title={isKiko() ? "Kiko, the chief" : `@${props.slug}`}
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
          <Bird spec={draft()} state={MOODS[mood()]} size={96} />
          <div class="flex min-w-0 flex-col gap-1">
            <p class="text-xs text-muted">
              {SPECIES[draft().species].label}
              {draft().accessory !== "none" ? ` in a ${ACCESSORIES[draft().accessory].label.toLowerCase()}` : ""} · {MOODS[mood()]!.charAt(0).toUpperCase()}{MOODS[mood()]!.slice(1)}
            </p>
            <Show when={isKiko()}>
              <p class="text-xs text-muted">Kiko always follows your theme color.</p>
            </Show>
          </div>
        </div>

        <Show when={!isKiko()}>
          <section class="flex flex-col gap-2">
            <h3 class="text-xs text-muted">Bird</h3>
            <div class="grid grid-cols-8 gap-1" role="radiogroup" aria-label="Bird">
              <For each={species()}>
                {(s) => (
                  <button type="button" role="radio" aria-checked={draft().species === s} aria-label={SPECIES[s].label} title={SPECIES[s].label} class={`${chip} aspect-square`} onClick={() => set({ species: s })}>
                    <Bird spec={{ species: s, tint: draft().tint, accessory: "none" }} size={34} />
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs text-muted">Color</h3>
          <div class="flex gap-1" role="radiogroup" aria-label="Color">
            <For each={TINTS.map((_, i) => i)}>
              {(t) => (
                <button type="button" role="radio" aria-checked={draft().tint === t} aria-label={`Color ${t + 1}`} class={`${chip} size-12`} onClick={() => set({ tint: t })}>
                  <Bird spec={{ ...draft(), tint: t, accessory: "none" }} size={34} />
                </button>
              )}
            </For>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs text-muted">Wears</h3>
          <div class="grid grid-cols-6 gap-1" role="radiogroup" aria-label="Accessory">
            <For each={ACCESSORY_IDS}>
              {(a) => (
                <button type="button" role="radio" aria-checked={draft().accessory === a} aria-label={ACCESSORIES[a].label} title={ACCESSORIES[a].label} class={`${chip} aspect-square`} onClick={() => set({ accessory: a })}>
                  <Bird spec={{ ...draft(), accessory: a }} size={34} />
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
