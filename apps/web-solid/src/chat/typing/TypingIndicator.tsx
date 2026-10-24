import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { captionOf, ELAPSED_AFTER_MS, motionOf } from "./action"
import { describe } from "./create-typing-presence"
import { room } from "../../state/room"
import { RunTree } from "../run/RunTree"
import "./typing.css"

export interface TypingIndicatorProps {
  typists: string[]
  seeds?: readonly string[]
  doings?: readonly (string | undefined)[]
  group?: boolean
  max?: number
  announceAfter?: number
  class?: string
}

const ROWS = 3

const CAPTION_AFTER_MS = 2000

function Row(props: { seed: string; doing?: string; group?: boolean }) {
  const motion = () => motionOf(props.doing)
  const [since, setSince] = createSignal(Date.now())
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(tick))
  createEffect(
    on(
      () => props.doing,
      () => {
        const at = Date.now()
        setSince(at)
        setNow(at)
      },
      { defer: true },
    ),
  )
  const elapsed = () => now() - since()
  const caption = () =>
    room.typingRun(props.seed) || elapsed() < CAPTION_AFTER_MS ? "" : captionOf(props.doing, elapsed())
  return (
    <div class="typing" data-component="typing-row" data-motion={motion()}>
      <Show when={props.group}>
        <IdentityAvatar seed={props.seed} size={32} class="typing-bird" />
      </Show>
      <div class="typing-body">
        <div class="typing-line">
          <div class="typing-bubble" aria-hidden="true">
            <span class="typing-dots">
              <span class="typing-dot" />
              <span class="typing-dot" />
              <span class="typing-dot" />
            </span>
          </div>
          <span
            class="typing-doing"
            data-component="typing-doing"
            data-elapsed={elapsed() >= ELAPSED_AFTER_MS ? "" : undefined}
            aria-hidden="true"
          >
            {caption()}
          </span>
        </div>
        <Show when={room.typingRun(props.seed)}>{(windowKey) => <RunTree windowKey={windowKey()} />}</Show>
      </div>
    </div>
  )
}

export function TypingIndicator(props: TypingIndicatorProps) {
  const max = () => props.max ?? 2
  const label = createMemo(() => {
    const doing = props.doings?.[0]
    if (props.typists.length === 1 && doing && motionOf(doing) !== "wave")
      return `${props.typists[0]} is ${doing.charAt(0).toLowerCase()}${doing.slice(1)}`
    return describe(props.typists, max())
  })
  const rows = createMemo(() => props.typists.slice(0, ROWS).map((name, i) => props.seeds?.[i] ?? name))
  const more = () => props.typists.length - ROWS

  const [announced, setAnnounced] = createSignal(label())
  createEffect(
    on(
      label,
      (text) => {
        const timer = setTimeout(() => setAnnounced(text), props.announceAfter ?? 700)
        onCleanup(() => clearTimeout(timer))
      },
      { defer: true },
    ),
  )

  return (
    <div class={`typing-stack ${props.class ?? ""}`} data-component="typing-indicator">
      <For each={rows()}>{(seed, i) => <Row seed={seed} doing={props.doings?.[i()]} group={props.group} />}</For>
      <Show when={more() > 0}>
        <span class="typing-more" data-group={props.group ? "" : undefined} aria-hidden="true">
          And {more()} {more() === 1 ? "other" : "others"}
        </span>
      </Show>
      <span class="typing-sr" role="status" aria-live="polite" aria-atomic="true">
        {announced()}
      </span>
    </div>
  )
}
