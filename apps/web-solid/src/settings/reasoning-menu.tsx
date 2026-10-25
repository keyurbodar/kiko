import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, ReasoningIcon } from "@kiko/ui/icons"
import { defaultThinking, THINKING_LABELS, type ThinkingLevel } from "@kiko/protocol"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { cn } from "../lib/cn"
import { placePanel } from "../lib/place-panel"
import { canReason } from "./agent-model"
import "./reasoning-menu.css"

const PANEL_W = 288
const PANEL_H = 148
const KEY_SAVE_MS = 400

function Slider(props: {
  levels: readonly ThinkingLevel[]
  value: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
  onCommit: (soon?: boolean) => void
  onDone: () => void
  autofocus?: boolean
}) {
  let rail: HTMLDivElement | undefined
  let slider: HTMLDivElement | undefined
  const [dragging, setDragging] = createSignal(false)
  const last = () => Math.max(1, props.levels.length - 1)
  const index = () => Math.max(0, props.levels.indexOf(props.value))
  const percent = (i: number) => `${(i / last()) * 100}%`
  const pick = (i: number) => {
    const level = props.levels[Math.min(props.levels.length - 1, Math.max(0, i))]
    if (level && level !== props.value) props.onChange(level)
  }
  const fromPointer = (event: PointerEvent) => {
    const box = rail?.getBoundingClientRect()
    if (!box?.width) return
    pick(Math.round(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * last()))
  }
  onMount(() => props.autofocus !== false && queueMicrotask(() => slider?.focus()))
  return (
    <div
      ref={slider}
      class="reasoning-slider"
      role="slider"
      tabindex="0"
      aria-label="Reasoning"
      aria-valuemin={0}
      aria-valuemax={props.levels.length - 1}
      aria-valuenow={index()}
      aria-valuetext={THINKING_LABELS[props.value]}
      data-dragging={dragging() ? "" : undefined}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        fromPointer(event)
      }}
      onPointerMove={(event) => dragging() && fromPointer(event)}
      onPointerUp={() => {
        setDragging(false)
        props.onCommit()
      }}
      onPointerCancel={() => {
        setDragging(false)
        props.onCommit()
      }}
      onKeyDown={(event) => {
        const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key]
        if (step) pick(index() + step)
        else if (event.key === "Home") pick(0)
        else if (event.key === "End") pick(props.levels.length - 1)
        else if (event.key === "Enter") {
          props.onCommit()
          props.onDone()
        } else return
        event.preventDefault()
        if (event.key !== "Enter") props.onCommit(true)
      }}
    >
      <div class="reasoning-rail" ref={rail}>
        <span class="reasoning-fill" style={{ width: percent(index()) }} />
        <For each={props.levels}>
          {(level, i) => (
            <span
              class="reasoning-notch"
              data-level={level}
              data-passed={i() <= index() ? "" : undefined}
              style={{ left: percent(i()) }}
            />
          )}
        </For>
        <span class="reasoning-thumb" style={{ left: percent(index()) }} />
      </div>
    </div>
  )
}

function ThinkingValue(props: { levels: readonly ThinkingLevel[]; value: ThinkingLevel }) {
  const isDefault = () => props.value === defaultThinking(props.levels)
  return (
    <span class="reasoning-value" data-level={props.value}>
      <span class="reasoning-default" data-shown={isDefault() ? "" : undefined} aria-hidden={!isDefault()}>
        Default
      </span>
      {THINKING_LABELS[props.value]}
    </span>
  )
}

export function ReasoningControl(props: {
  title: string
  levels: readonly ThinkingLevel[]
  value: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
  onDone: () => void
  autofocus?: boolean
}) {
  const [held, setHeld] = createSignal<ThinkingLevel>()
  const [savedFrom, setSavedFrom] = createSignal<ThinkingLevel>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const shown = () => held() ?? props.value
  const commit = () => {
    clearTimeout(timer)
    const level = held()
    if (level === undefined || savedFrom() !== undefined) return
    if (level === props.value) return void setHeld(undefined)
    setSavedFrom(props.value)
    props.onChange(level)
  }
  createEffect(() => {
    const from = savedFrom()
    if (from === undefined || props.value === from) return
    setHeld(undefined)
    setSavedFrom(undefined)
  })
  onCleanup(commit)
  return (
    <>
      <div class="reasoning-head">
        <span class="reasoning-title">{props.title}</span>
        <ThinkingValue levels={props.levels} value={shown()} />
      </div>
      <Slider
        levels={props.levels}
        value={shown()}
        autofocus={props.autofocus}
        onChange={(level) => {
          setSavedFrom(undefined)
          setHeld(level)
        }}
        onCommit={(soon) => {
          clearTimeout(timer)
          if (soon) timer = setTimeout(commit, KEY_SAVE_MS)
          else commit()
        }}
        onDone={props.onDone}
      />
      <ThinkingEnds levels={props.levels} />
    </>
  )
}

function ThinkingEnds(props: { levels: readonly ThinkingLevel[] }) {
  const first = () => props.levels[0]
  const end = () => props.levels[props.levels.length - 1]
  return (
    <div class="reasoning-ends">
      <span>{first() ? THINKING_LABELS[first()!] : ""}</span>
      <span>{end() ? THINKING_LABELS[end()!] : ""}</span>
    </div>
  )
}

function Panel(props: {
  levels: readonly ThinkingLevel[]
  value: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
  trigger: () => HTMLElement | undefined
  placement: "top-start" | "bottom-end"
  onClose: (focusTrigger: boolean) => void
}) {
  let panel: HTMLDivElement | undefined
  const box = props.trigger()?.getBoundingClientRect() ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const form = props.trigger()?.closest(".composer-form")?.getBoundingClientRect()
  const anchor = { left: box.left, right: box.right, top: form?.top ?? box.top, bottom: form?.bottom ?? box.bottom }
  const place = placePanel(
    anchor,
    PANEL_W,
    PANEL_H,
    { width: window.innerWidth, height: window.innerHeight },
    props.placement === "top-start" ? "above" : "below",
    props.placement === "top-start" ? "start" : "end",
  )
  const above = props.placement === "top-start"
  createEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel?.contains(target) && !props.trigger()?.contains(target)) props.onClose(false)
    }
    document.addEventListener("pointerdown", outside, true)
    onCleanup(() => document.removeEventListener("pointerdown", outside, true))
  })
  return (
    <Portal>
      <div
        ref={panel}
        class="reasoning-panel"
        data-component="reasoning-menu"
        data-above={above ? "" : undefined}
        style={place}
        role="dialog"
        aria-label="Reasoning"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          props.onClose(true)
        }}
      >
        <ReasoningControl
          title="Reasoning"
          levels={props.levels}
          value={props.value}
          onChange={props.onChange}
          onDone={() => props.onClose(true)}
        />
      </div>
    </Portal>
  )
}

export function ReasoningMenu(props: {
  levels: readonly ThinkingLevel[] | undefined
  value: ThinkingLevel | undefined
  onChange: (level: ThinkingLevel) => void
  class?: string
  placement?: "top-start" | "bottom-end"
}) {
  let trigger: HTMLButtonElement | undefined
  const [open, setOpen] = createSignal(false)
  const levels = () => props.levels ?? []
  const value = () => props.value ?? defaultThinking(levels())
  const close = (focusTrigger: boolean) => {
    setOpen(false)
    if (focusTrigger) trigger?.focus()
  }
  return (
    <Show when={canReason(props.levels)}>
      <button
        ref={trigger}
        type="button"
        class={cn(
          "reasoning-trigger flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2 text-label text-fg2 hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg",
          props.class,
        )}
        aria-label="Reasoning"
        aria-haspopup="dialog"
        aria-expanded={open()}
        title="Reasoning"
        data-component="reasoning-trigger"
        onClick={() => setOpen((now) => !now)}
      >
        <RemixIcon icon={ReasoningIcon} size={14} />
        <span class="reasoning-label">{THINKING_LABELS[value()]}</span>
        <RemixIcon icon={ChevronDownIcon} size={10} class="opacity-70" />
      </button>
      <Show when={open()}>
        <Panel
          levels={levels()}
          value={value()}
          onChange={props.onChange}
          trigger={() => trigger}
          placement={props.placement ?? "top-start"}
          onClose={close}
        />
      </Show>
    </Show>
  )
}
