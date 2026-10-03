import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { look, saveLook } from "../theme/live"
import { Bird } from "./bird"
import { ACCESSORIES, ACCESSORY_IDS, SPECIES, SPECIES_IDS, TINTS, formatBird, type BirdSpec, type BirdState } from "./birds"
import { birdFor } from "./choices"
import { birdPickerSlug, closeBirdPicker } from "./picker-state"

/*
 * The bird picker: species, tint and what the bird wears, for one agent. The preview acts
 * out every mood the agent can be in, so a person sees the bird thinking and typing before
 * they keep it. The kiko agent is always the kiko bird; only its tint and outfit change.
 */

const MOODS: BirdState[] = ["wave", "thinking", "typing", "working", "sending", "idle"]

// The pick is a filled cell with an accent edge; focus is a plain ring, and only from the keyboard.
const chip =
  "grid place-items-center rounded-xl outline-none hover:bg-[var(--btn-bg)] [:root[data-input=keys]_&]:focus-visible:ring-2 [:root[data-input=keys]_&]:focus-visible:ring-[var(--text-faint)] aria-checked:bg-[var(--accent-wash)] aria-checked:shadow-[inset_0_0_0_1.5px_var(--accent)]"

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
    <div class="flex flex-col gap-4" data-component="bird-picker" data-slug={props.slug}>
      <div class="flex items-center gap-4 rounded-2xl bg-[var(--card)] [box-shadow:var(--card-shadow)] p-4">
        <Bird spec={draft()} state={MOODS[mood()]} size={96} />
        <div class="flex min-w-0 flex-col gap-1">
          <ModalV2.Title class="text-base font-medium text-text">{isKiko() ? "kiko, the chief" : `@${props.slug}`}</ModalV2.Title>
          <p class="text-xs text-muted">
            {SPECIES[draft().species].label}
            {draft().accessory !== "none" ? ` in a ${ACCESSORIES[draft().accessory].label}` : ""} · {MOODS[mood()]}
          </p>
          <Show when={isKiko()}>
            <p class="text-xs text-muted">kiko always follows your theme color.</p>
          </Show>
        </div>
      </div>

      <Show when={!isKiko()}>
        <section class="flex flex-col gap-2">
          <h3 class="text-xs text-muted">bird</h3>
          <div class="grid grid-cols-8 gap-1" role="radiogroup" aria-label="bird">
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
        <h3 class="text-xs text-muted">color</h3>
        <div class="flex gap-1" role="radiogroup" aria-label="color">
          <For each={TINTS.map((_, i) => i)}>
            {(t) => (
              <button type="button" role="radio" aria-checked={draft().tint === t} aria-label={`color ${t + 1}`} class={`${chip} size-12`} onClick={() => set({ tint: t })}>
                <Bird spec={{ ...draft(), tint: t, accessory: "none" }} size={34} />
              </button>
            )}
          </For>
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-xs text-muted">wears</h3>
        <div class="grid grid-cols-6 gap-1" role="radiogroup" aria-label="accessory">
          <For each={ACCESSORY_IDS}>
            {(a) => (
              <button type="button" role="radio" aria-checked={draft().accessory === a} aria-label={ACCESSORIES[a].label} title={ACCESSORIES[a].label} class={`${chip} aspect-square`} onClick={() => set({ accessory: a })}>
                <Bird spec={{ ...draft(), accessory: a }} size={34} />
              </button>
            )}
          </For>
        </div>
      </section>

      <div class="flex items-center justify-between gap-2">
        <button type="button" class="rounded-[10px] px-3 py-1.5 text-sm text-muted hover:bg-[var(--btn-bg)]" onClick={reset} disabled={!look().birds[props.slug]}>
          use its own bird
        </button>
        <div class="flex gap-2">
          <button type="button" class="rounded-[10px] px-3 py-1.5 text-sm hover:bg-[var(--btn-bg)]" onClick={closeBirdPicker}>
            cancel
          </button>
          <button type="button" class="rounded-[10px] bg-[var(--accent-fill)] px-3 py-1.5 text-sm text-[var(--on-accent)] hover:bg-[var(--accent-hover)]" data-action="save-bird" onClick={save}>
            keep this bird
          </button>
        </div>
      </div>
    </div>
  )
}

/** Mounted once in the shell. Opens for whichever agent `openBirdPicker` names. */
export default function BirdPicker() {
  return (
    <Show when={birdPickerSlug()}>
      {(slug) => (
        <ModalV2 open onOpenChange={(open: boolean) => !open && closeBirdPicker()}>
          <ModalV2.Portal>
            <ModalV2.Overlay />
            <ModalV2.Content class="flex max-h-[90vh] w-[min(460px,calc(100vw-32px))] flex-col overflow-y-auto rounded-[calc(20px*var(--brm))] bg-menu-bg p-4 text-text shadow-popover">
              <Picker slug={slug()} />
            </ModalV2.Content>
          </ModalV2.Portal>
        </ModalV2>
      )}
    </Show>
  )
}
