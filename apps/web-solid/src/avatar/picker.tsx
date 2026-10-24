import { CHARM_NAMES, FLAVOUR_NAMES, OUTFIT_NAMES } from "@kiko/avatar"
import { cachedUri } from "@kiko/avatar/uri"
import { KIKO } from "@kiko/protocol"
import type { AvatarPins, Look } from "@kiko/theme/look"
import { createSignal, For, type JSX, Show } from "solid-js"
import { Dialog } from "../lib/dialog"
import { Button } from "../settings/kit"
import { look, saveLook } from "../theme/live"
import { pinsFor } from "./picks"
import { avatarPickerSlug, closeAvatarPicker } from "./picker-state"

const CHARMS = ["none", ...CHARM_NAMES] as const
const OUTFITS = ["none", ...OUTFIT_NAMES] as const

const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

const cell =
  "grid aspect-square place-items-center rounded-pop outline-none hover:bg-[var(--hover)] aria-checked:bg-[var(--active)] aria-checked:shadow-[inset_0_0_0_1px_var(--fg3)]"

function withPins(avatars: Look["avatars"], slug: string, pins: AvatarPins): Look["avatars"] {
  const { [slug]: _, ...rest } = avatars
  return Object.keys(pins).length ? { ...rest, [slug]: pins } : rest
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-2">
      <h3 class="text-hint text-fg2">{props.title}</h3>
      <div class="grid grid-cols-8 gap-1" role="radiogroup" aria-label={props.title}>
        {props.children}
      </div>
    </section>
  )
}

function Choice(props: { slug: string; name: string; selected: boolean; pins: AvatarPins; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      aria-label={props.name}
      title={props.name}
      class={cell}
      onClick={props.onPick}
    >
      <img
        src={cachedUri(props.slug, pinsFor(props.slug, props.pins))}
        alt=""
        width={32}
        height={32}
        draggable={false}
      />
    </button>
  )
}

function Picker(props: { slug: string }) {
  const isKiko = () => props.slug === KIKO
  const [draft, setDraft] = createSignal<AvatarPins>({ ...look().avatars[props.slug] })
  const set = (patch: AvatarPins) => setDraft({ ...draft(), ...patch })
  const save = () => {
    saveLook({ ...look(), avatars: withPins(look().avatars, props.slug, draft()) })
    closeAvatarPicker()
  }
  const reset = () => {
    saveLook({ ...look(), avatars: withPins(look().avatars, props.slug, {}) })
    closeAvatarPicker()
  }

  return (
    <Dialog
      open
      onClose={closeAvatarPicker}
      title={isKiko() ? "Kiko, the chief" : `@${props.slug}`}
      data-component="avatar-picker"
      footer={
        <>
          <Button variant="ghost" class="mr-auto" onClick={reset} disabled={!look().avatars[props.slug]}>
            Reset to generated
          </Button>
          <Button variant="ghost" onClick={closeAvatarPicker}>
            Cancel
          </Button>
          <Button variant="primary" data-action="save-avatar" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div class="flex flex-col gap-5" data-slug={props.slug}>
        <div class="flex justify-center">
          <img
            src={cachedUri(props.slug, pinsFor(props.slug, draft()))}
            alt=""
            width={96}
            height={96}
            draggable={false}
          />
        </div>
        <Show when={!isKiko()}>
          <Section title="Flavor">
            <For each={FLAVOUR_NAMES}>
              {(f) => (
                <Choice
                  slug={props.slug}
                  name={label(f)}
                  selected={draft().flavour === f}
                  pins={{ flavour: f }}
                  onPick={() => set({ flavour: f })}
                />
              )}
            </For>
          </Section>
        </Show>
        <Section title="Charm">
          <For each={CHARMS}>
            {(c) => (
              <Choice
                slug={props.slug}
                name={label(c)}
                selected={(draft().charm ?? "none") === c}
                pins={{ ...draft(), charm: c }}
                onPick={() => set({ charm: c })}
              />
            )}
          </For>
        </Section>
        <Section title="Outfit">
          <For each={OUTFITS}>
            {(o) => (
              <Choice
                slug={props.slug}
                name={label(o)}
                selected={(draft().outfit ?? "none") === o}
                pins={{ ...draft(), outfit: o }}
                onPick={() => set({ outfit: o })}
              />
            )}
          </For>
        </Section>
      </div>
    </Dialog>
  )
}

export default function AvatarPicker() {
  return <Show when={avatarPickerSlug()}>{(slug) => <Picker slug={slug()} />}</Show>
}
