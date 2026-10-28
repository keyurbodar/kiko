import { ChevronRightIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { type Thought, thoughtMs, thoughtText } from "../../state/thoughts"
import { elapsedLabel } from "../run/duration"
import { Shine } from "../run/Shine"
import { Mochi } from "../ui/Mochi"
import "./thinking.css"

const OPEN_KEY = "kiko.thinking-open"
const LINE_EVERY_MS = 700
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

function remembered(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1"
  } catch {
    return false
  }
}

function remember(open: boolean) {
  try {
    if (open) localStorage.setItem(OPEN_KEY, "1")
    else localStorage.removeItem(OPEN_KEY)
  } catch {}
}

function took(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function useNow(live: () => boolean) {
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!live()) return
    setNow(Date.now())
    const clock = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(clock))
  })
  return now
}

function usePacedLine(text: () => string) {
  const [shown, setShown] = createSignal(text())
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  createEffect(
    on(text, (next) => {
      clearTimeout(timer)
      const wait = LINE_EVERY_MS - (Date.now() - last)
      const show = () => {
        last = Date.now()
        setShown(next)
      }
      if (wait <= 0) show()
      else timer = setTimeout(show, wait)
    }),
  )
  return shown
}

function Stream(props: { text: string; follow: boolean; live?: boolean }): JSX.Element {
  let box!: HTMLDivElement
  let pinned = props.follow
  const mark = () => {
    box.toggleAttribute("data-fade-top", box.scrollTop > 0)
    box.toggleAttribute("data-fade-bottom", box.scrollHeight - box.scrollTop - box.clientHeight > 1)
  }
  createEffect(
    on(
      () => props.text,
      () => {
        if (pinned) box.scrollTop = box.scrollHeight
        mark()
      },
    ),
  )
  const onScroll = () => {
    pinned = props.follow && box.scrollHeight - box.scrollTop - box.clientHeight < 8
    mark()
  }
  return (
    <div
      ref={box}
      class="thinking-stream"
      data-component="thinking-stream"
      data-live={props.live ? "" : undefined}
      onScroll={onScroll}
    >
      {props.text}
    </div>
  )
}

function Chevron(props: { open: boolean }): JSX.Element {
  return (
    <RemixIcon
      icon={ChevronRightIcon}
      size={12}
      class="thinking-chevron motion-run-chevron"
      data-open={props.open ? "" : undefined}
    />
  )
}

export type StepsToggle = { open: boolean; toggle: () => void }

function Caption(props: { text: string; running: boolean }): JSX.Element {
  const [leaving, setLeaving] = createSignal<string>()
  createEffect(
    on(
      () => props.text,
      (_, previous) => setLeaving(previous && !matchMedia(REDUCED_MOTION).matches ? previous : undefined),
      { defer: true },
    ),
  )
  return (
    <span class="thinking-caption">
      <Show when={leaving()} keyed>
        {(old) => (
          <span class="thinking-live thinking-leaving" aria-hidden="true" onAnimationEnd={() => setLeaving(undefined)}>
            {old}
          </span>
        )}
      </Show>
      <Show when={props.text} keyed>
        {(text) => (
          <Shine running={props.running} class="thinking-live">
            {text}
          </Shine>
        )}
      </Show>
    </span>
  )
}

export function ThinkingLine(props: {
  thought: Thought | undefined
  fallback: string
  since?: number
  steps?: StepsToggle
}): JSX.Element {
  const live = () => (props.thought && !props.thought.over ? props.thought : undefined)
  const text = () => {
    const thought = live()
    return thought ? thoughtText(thought) : ""
  }
  const thinking = () => {
    const thought = live()
    return thought !== undefined && thought.openSince !== null && text() !== ""
  }
  const caption = usePacedLine(() => props.fallback)
  const [open, setOpen] = createSignal(remembered())
  const now = useNow(() => !!live() || props.since !== undefined)
  createEffect(() => {
    if (thinking()) setOpen(true)
  })
  const toggle = () => {
    const next = !open()
    setOpen(next)
    remember(next)
  }
  const elapsed = () => (props.since === undefined ? undefined : elapsedLabel(now() - props.since))
  return (
    <div class="thinking" data-component="thinking-line" data-open={open() && text() ? "" : undefined}>
      <Show
        when={text()}
        fallback={
          <Show
            when={props.steps}
            fallback={
              <div class="thinking-row">
                <Mochi size={20} />
                <Caption text={caption()} running />
                <Show when={elapsed()}>{(time) => <span class="thinking-time">{time()}</span>}</Show>
              </div>
            }
          >
            {(steps) => (
              <button
                type="button"
                class="thinking-row thinking-toggle"
                aria-expanded={steps().open}
                aria-label={`${caption()}. ${steps().open ? "Hide" : "Show"} steps`}
                onClick={() => steps().toggle()}
              >
                <Mochi size={20} />
                <Caption text={caption()} running />
                <Show when={elapsed()}>{(time) => <span class="thinking-time">{time()}</span>}</Show>
                <Chevron open={steps().open} />
              </button>
            )}
          </Show>
        }
      >
        <button type="button" class="thinking-row thinking-toggle" aria-expanded={open()} onClick={toggle}>
          <Mochi size={20} />
          <Caption text={thinking() ? "Thinking" : caption()} running={thinking()} />
          <Show when={thinking()}>
            <span class="thinking-time">{took(thoughtMs(live()!, now()))}</span>
          </Show>
          <Chevron open={open()} />
        </button>
        <div class="thinking-fold" data-shut={open() ? undefined : ""}>
          <div>
            <Stream text={text()} follow live={thinking()} />
          </div>
        </div>
      </Show>
    </div>
  )
}

export function ThoughtRow(props: { thought: Thought }): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const text = () => thoughtText(props.thought)
  return (
    <Show when={props.thought.openSince === null && text()}>
      <div class="thought" data-component="thought-row">
        <button
          type="button"
          class="thought-head"
          aria-expanded={open()}
          data-disclosure=""
          onClick={() => setOpen(!open())}
        >
          Thought for {took(thoughtMs(props.thought, Date.now()))}
          <Chevron open={open()} />
        </button>
        <Show when={open()}>
          <Stream text={text()} follow={false} live={false} />
        </Show>
      </div>
    </Show>
  )
}
