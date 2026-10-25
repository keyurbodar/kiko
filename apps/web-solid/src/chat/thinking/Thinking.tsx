import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { latestLine, type Thought, thoughtMs, thoughtText } from "../../state/thoughts"
import { Shine } from "../run/Shine"
import { Mochi } from "../ui/Mochi"
import "./thinking.css"

const OPEN_KEY = "kiko.thinking-open"
const LINE_EVERY_MS = 2_000

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

function Stream(props: { text: string }) {
  let box!: HTMLDivElement
  let pinned = true
  createEffect(
    on(
      () => props.text,
      () => {
        if (pinned) box.scrollTop = box.scrollHeight
        box.toggleAttribute("data-overflow", box.scrollHeight > box.clientHeight && box.scrollTop > 0)
      },
    ),
  )
  const onScroll = () => {
    pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 8
    box.toggleAttribute("data-overflow", box.scrollTop > 0)
  }
  return (
    <div ref={box} class="thinking-stream" data-component="thinking-stream" onScroll={onScroll}>
      {props.text}
    </div>
  )
}

export function ThinkingLine(props: { thought: Thought | undefined; fallback: string }): JSX.Element {
  const live = () => (props.thought && !props.thought.over ? props.thought : undefined)
  const text = () => {
    const thought = live()
    return thought ? thoughtText(thought) : ""
  }
  const thinking = () => {
    const thought = live()
    return thought !== undefined && thought.openSince !== null && text() !== ""
  }
  const line = usePacedLine(() => (thinking() ? latestLine(text()) : props.fallback))
  const [open, setOpen] = createSignal(remembered())
  const now = useNow(() => !!live())
  const toggle = () => {
    const next = !open()
    setOpen(next)
    remember(next)
  }
  return (
    <div class="thinking" data-component="thinking-line" data-open={open() && text() ? "" : undefined}>
      <Show
        when={open() && text()}
        fallback={
          <div class="thinking-row">
            <Mochi size={20} />
            <span class="thinking-cycle" aria-hidden="true">
              <Show when={line()} keyed>
                {(shown) => (
                  <Shine running class="thinking-live">
                    {shown}
                  </Shine>
                )}
              </Show>
            </span>
          </div>
        }
      >
        <button type="button" class="thinking-row thinking-toggle" aria-expanded="true" onClick={toggle}>
          <Mochi size={20} />
          <Shine running={thinking()} class="thinking-live">
            Thinking
          </Shine>
          <span class="thinking-time">{took(thoughtMs(live()!, now()))}</span>
          <RemixIcon icon={ChevronUpIcon} size={12} class="thinking-chevron" />
        </button>
        <Stream text={text()} />
      </Show>
      <Show when={!open() && text()}>
        <button type="button" class="thinking-show" aria-expanded="false" onClick={toggle}>
          Show thinking
          <RemixIcon icon={ChevronDownIcon} size={12} />
        </button>
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
          <RemixIcon
            icon={ChevronRightIcon}
            size={12}
            class="thought-chevron motion-run-chevron"
            data-open={open() ? "" : undefined}
          />
        </button>
        <Show when={open()}>
          <div class="thought-text">{text()}</div>
        </Show>
      </div>
    </Show>
  )
}
