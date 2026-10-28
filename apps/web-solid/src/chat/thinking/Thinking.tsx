import { ChevronRightIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { type Thought, thoughtMs, thoughtText } from "../../state/thoughts"
import { createRichTextCache } from "../rich/block-cache"
import { RichText } from "../rich/RichText"
import { elapsedLabel } from "../run/duration"
import { Shine } from "../run/Shine"
import { Mochi } from "../ui/Mochi"
import { useSmoothText } from "./smooth"
import "./thinking.css"

const OPEN_KEY = "kiko.thinking-open"
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"
const HEADING = /^ {0,3}#{1,6}[ \t]+(.+)$/gm
const BOLD_LEAD = /^ {0,3}\*\*([^*\n]+)\*\*/gm
const LINK = /!?\[([^\]]*)\]\([^)]*\)/g
const BLOCK_MARKER = /^[ \t]*(?:#{1,6}|[-*+]|\d+[.)]|>)[ \t]+/gm
const EMPHASIS = /`+|\*\*|__|~~/g
const ITALIC = /(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g

function plainPreview(markdown: string): string {
  return markdown
    .replace(LINK, "$1")
    .replace(BLOCK_MARKER, "")
    .replace(EMPHASIS, "")
    .replace(ITALIC, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
}

function latestMatch(text: string, pattern: RegExp): { index: number; value: string } | undefined {
  let found: { index: number; value: string } | undefined
  for (const match of text.matchAll(pattern)) found = { index: match.index, value: match[1] ?? "" }
  return found
}

function latestLead(markdown: string): { index: number; value: string } | undefined {
  const heading = latestMatch(markdown, HEADING)
  const bold = latestMatch(markdown, BOLD_LEAD)
  if (!heading) return bold
  if (!bold) return heading
  return heading.index > bold.index ? heading : bold
}

function lastSentence(markdown: string): string {
  const plain = plainPreview(markdown)
  const ends = Array.from(plain.matchAll(/[.!?]+["'”’)]?/g))
  const last = ends.at(-1)
  if (!last) return plain
  const end = last.index + last[0].length
  if (end < plain.length) return plain.slice(end).trim()
  const previous = ends.at(-2)
  return previous ? plain.slice(previous.index + previous[0].length).trim() : plain
}

function thoughtPreview(markdown: string): string {
  const lead = latestLead(markdown)
  return lead ? plainPreview(lead.value) : lastSentence(markdown)
}

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

export function ThoughtStream(props: { text: string; live?: boolean; follow?: boolean; class?: string }): JSX.Element {
  const live = () => props.live === true
  const shown = useSmoothText(() => props.text, live)
  const cache = createRichTextCache()
  const tree = createMemo(() => cache.parse(shown()))
  const follows = () => props.follow ?? live()
  let box: HTMLDivElement | undefined
  let frame: number | undefined
  let pinned = true

  const mark = () => box?.toggleAttribute("data-scrolled", box.scrollTop > 0)
  const stick = () => {
    frame = undefined
    if (!box || !pinned || !follows()) return
    box.scrollTop = box.scrollHeight
    mark()
  }
  const schedule = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(stick)
  }
  const onScroll = () => {
    if (!box) return
    pinned = follows() && box.scrollHeight - box.scrollTop - box.clientHeight <= 24
    mark()
  }
  createEffect(on([shown, follows], schedule))
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })
  return (
    <RichText
      tree={tree()}
      class={`thinking-stream${props.class ? ` ${props.class}` : ""}`}
      component="thinking-stream"
      streaming={live()}
      onScroll={onScroll}
      ref={(element) => {
        box = element
      }}
    />
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
  const caption = () => (text() ? thoughtPreview(text()) || "Thinking" : props.fallback)
  const [open, setOpen] = createSignal(remembered())
  const now = useNow(() => !!live() || props.since !== undefined)
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
                <Caption text={props.fallback} running />
                <Show when={elapsed()}>{(time) => <span class="thinking-time">{time()}</span>}</Show>
              </div>
            }
          >
            {(steps) => (
              <button
                type="button"
                class="thinking-row thinking-toggle"
                aria-expanded={steps().open}
                aria-label={`${props.fallback}. ${steps().open ? "Hide" : "Show"} steps`}
                onClick={() => steps().toggle()}
              >
                <Mochi size={20} />
                <Caption text={props.fallback} running />
                <Show when={elapsed()}>{(time) => <span class="thinking-time">{time()}</span>}</Show>
                <Chevron open={steps().open} />
              </button>
            )}
          </Show>
        }
      >
        <button type="button" class="thinking-row thinking-toggle" aria-expanded={open()} onClick={toggle}>
          <Mochi size={20} />
          <Caption text={caption()} running={thinking()} />
          <Show when={thinking()}>
            <span class="thinking-time">{took(thoughtMs(live()!, now()))}</span>
          </Show>
          <Chevron open={open()} />
        </button>
        <Show when={open()}>
          <ThoughtStream text={text()} live follow />
        </Show>
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
          <ThoughtStream text={text()} follow={false} />
        </Show>
      </div>
    </Show>
  )
}
