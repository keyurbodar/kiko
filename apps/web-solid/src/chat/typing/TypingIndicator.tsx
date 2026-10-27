import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { captionOf, motionOf } from "./action"
import { describe } from "./create-typing-presence"
import { room } from "../../state/room"
import { RunTree } from "../run/RunTree"
import { ThinkingLine } from "../thinking/Thinking"
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

function Row(props: { seed: string; doing?: string; group?: boolean }) {
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
  const runStart = () => {
    const key = room.typingRun(props.seed)
    const steps = key ? room.runSteps(key) : []
    return steps.length ? Math.min(...steps.map((step) => step.startedAt)) : undefined
  }
  const caption = () => (room.typingRun(props.seed) ? "Working for" : captionOf(props.doing, now() - since()))
  return (
    <div class="typing" data-component="typing-row">
      <Show when={props.group}>
        <IdentityAvatar seed={props.seed} size={32} class="typing-bird" />
      </Show>
      <div class="typing-body">
        <ThinkingLine thought={room.thinking(props.seed)} fallback={caption()} since={runStart()} />
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
