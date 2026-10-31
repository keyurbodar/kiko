import { ArrowDownIcon, ArrowUpIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createSignal, For, Index, onCleanup, Show, type JSX } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import "./scroll-faces.css"

const TURN_MS = 1200

const PILL_FACES = 3

export type NewAbove = { count: number; slugs: readonly string[] }

function Faces(props: { slugs: readonly string[] }): JSX.Element {
  const [turn, setTurn] = createSignal(0)
  createEffect(() => {
    if (props.slugs.length < 2) return setTurn(0)
    const timer = setInterval(() => setTurn((n) => n + 1), TURN_MS)
    onCleanup(() => clearInterval(timer))
  })
  const shown = () => turn() % Math.max(props.slugs.length, 1)
  return (
    <span class="scroll-faces-stack" data-solo={props.slugs.length === 1 ? "" : undefined}>
      <Index each={props.slugs}>
        {(slug, i) => (
          <span class="scroll-faces-face" data-shown={shown() === i ? "" : undefined}>
            <IdentityAvatar seed={slug()} size={props.slugs.length === 1 ? 26 : 24} />
          </span>
        )}
      </Index>
    </span>
  )
}

export function ScrollDown(props: {
  shown: boolean
  working: readonly string[]
  landed: boolean
  onClick: () => void
}): JSX.Element {
  const working = () => props.working.length > 0
  return (
    <button
      type="button"
      class="scroll-faces-down"
      data-component="chat-scroll-down"
      data-hidden={props.shown ? undefined : ""}
      data-working={working() ? "" : undefined}
      aria-label={working() ? "Scroll to the agents working below" : "Scroll to end"}
      aria-hidden={props.shown ? undefined : "true"}
      tabIndex={props.shown ? 0 : -1}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => props.onClick()}
    >
      <Show when={working()}>
        <span class="scroll-faces-ind">
          <Faces slugs={props.working} />
        </span>
      </Show>
      <span class="scroll-faces-arrow">
        <RemixIcon icon={ArrowDownIcon} size={16} />
      </span>
      <Show when={props.landed && !working()}>
        <span class="scroll-faces-dot" data-component="chat-scroll-down-new" />
      </Show>
    </button>
  )
}

export function NewAbovePill(props: { above: NewAbove | null; onClick: () => void }): JSX.Element {
  return (
    <div class="scroll-faces-top" data-hidden={props.above ? undefined : ""}>
      <Show when={props.above}>
        {(above) => (
          <button
            type="button"
            class="scroll-faces-pill"
            data-component="chat-new-above"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => props.onClick()}
          >
            <span class="scroll-faces-pill-says">
              <Show when={above().slugs.length > 0}>
                <span class="scroll-faces-pill-faces" aria-hidden="true">
                  <For each={above().slugs.slice(0, PILL_FACES)}>
                    {(slug) => <IdentityAvatar seed={slug} size={22} class="scroll-faces-pill-face" />}
                  </For>
                </span>
              </Show>
              <span>{above().count} new above</span>
              <RemixIcon icon={ArrowUpIcon} size={16} class="text-tertiary" />
            </span>
            <span class="scroll-faces-pill-arrow" aria-hidden="true">
              <RemixIcon icon={ArrowUpIcon} size={16} />
            </span>
          </button>
        )}
      </Show>
    </div>
  )
}
