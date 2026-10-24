import { RemixIcon, type Glyph } from "@kiko/ui/remix-icon"
import { ChevronLeftIcon, ChevronRightIcon } from "@kiko/ui/icons"
import { createEffect, createSignal, For, type JSX, on, onCleanup, onMount, Show } from "solid-js"
import { cn } from "../lib/cn"
import { pageIn } from "../lib/motion"
import "./page-ui.css"

export function PageFrame(props: {
  title: string
  back?: { label: string; onClick: () => void }
  children: JSX.Element
}) {
  return (
    <div class="@container/page flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-bg" data-component="page-frame">
      <div ref={pageIn} class="mx-auto flex w-full max-w-[1000px] flex-col px-5 pb-20 @min-[640px]/page:px-8">
        <header class="flex flex-col gap-1 pt-8 max-[767px]:pt-14 @min-[640px]/page:pt-10">
          <Show when={props.back}>
            {(back) => (
              <button
                type="button"
                class="group -ml-1 flex w-fit cursor-pointer items-center gap-1 rounded-row px-1 py-0.5 text-[13px] text-fg3 transition-colors duration-[var(--dur-hover)] hover:text-fg"
                onClick={back().onClick}
              >
                <RemixIcon
                  icon={ChevronLeftIcon}
                  size={14}
                  class="transition-transform duration-[var(--dur-hover)] group-hover:-translate-x-0.5"
                />
                {back().label}
              </button>
            )}
          </Show>
          <h1 class="font-display text-[40px] leading-[44px] font-normal tracking-[-0.01em] text-fg [font-variation-settings:var(--display-variation)]">
            {props.title}
          </h1>
        </header>
        {props.children}
      </div>
    </div>
  )
}

type TabOption<T extends string> = { value: T; label: string; [data: `data-${string}`]: string | undefined }

export function PageTabs<T extends string>(props: {
  label: string
  value: T
  options: readonly TabOption<T>[]
  onChange: (value: T) => void
  quiet?: boolean
  [data: `data-${string}`]: string | undefined
}) {
  let list!: HTMLDivElement
  const [pill, setPill] = createSignal<{ x: number; w: number } | null>(null)
  const [settled, setSettled] = createSignal(false)
  const measure = () => {
    const el = list.querySelector<HTMLElement>('[aria-selected="true"]')
    setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
  }
  onMount(() => {
    measure()
    requestAnimationFrame(() => setSettled(true))
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    onCleanup(() => observer.disconnect())
  })
  createEffect(on(() => props.value, measure, { defer: true }))
  const move = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (!step) return
    const at = props.options.findIndex((o) => o.value === props.value)
    const next = props.options[(at + step + props.options.length) % props.options.length]
    if (!next) return
    event.preventDefault()
    props.onChange(next.value)
    queueMicrotask(() => list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
  }
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={props.label}
      class={cn(
        "page-tabs relative flex w-fit items-center",
        props.quiet ? "gap-0.5 rounded-[11px] bg-panel p-0.5" : "gap-1",
      )}
      data-settled={settled() ? "" : undefined}
      data-component={props["data-component"]}
      onKeyDown={move}
    >
      <Show when={pill()}>
        {(p) => (
          <span
            aria-hidden="true"
            class={cn(
              "page-tabs-pill absolute top-0 left-0 bg-active",
              props.quiet ? "top-0.5 h-[calc(100%-4px)] rounded-[9px]" : "h-full rounded-[10px]",
            )}
            style={{ width: `${p().w}px`, transform: `translateX(${p().x}px)` }}
          />
        )}
      </Show>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.value === option.value}
            tabindex={props.value === option.value ? 0 : -1}
            class="relative z-[1] flex h-8 cursor-pointer items-center gap-2 rounded-[10px] px-3.5 text-[14px] font-medium text-fg2 transition-colors duration-[var(--dur-hover)] hover:text-fg aria-selected:text-fg"
            data-section={option["data-section"]}
            data-tag={option["data-tag"]}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

export function ToolButton(props: {
  label: string
  icon: Glyph
  onClick?: () => void
  pressed?: boolean
  ref?: (el: HTMLButtonElement) => void
}) {
  return (
    <button
      ref={props.ref}
      type="button"
      aria-label={props.label}
      aria-pressed={props.pressed}
      class="grid size-8 cursor-pointer place-items-center rounded-[9px] text-fg2 transition-[background-color,color,transform] duration-[var(--dur-hover)] hover:bg-hover hover:text-fg active:scale-[0.97] aria-pressed:bg-active aria-pressed:text-fg"
      onClick={() => props.onClick?.()}
    >
      <RemixIcon icon={props.icon} size={17} />
    </button>
  )
}

export function SectionHead(props: { title: string; count?: number; onAll?: () => void; allLabel?: string }) {
  return (
    <div class="flex h-8 items-end justify-between">
      <h2 class="flex items-baseline gap-2 text-[15px] font-semibold text-fg">
        {props.title}
        <Show when={props.count !== undefined}>
          <span class="text-[13px] font-normal text-fg4">{props.count}</span>
        </Show>
      </h2>
      <Show when={props.onAll}>
        <button
          type="button"
          class="group flex cursor-pointer items-center gap-1 text-[13px] text-fg3 transition-colors duration-[var(--dur-hover)] hover:text-fg"
          onClick={props.onAll}
        >
          {props.allLabel ?? "Show all"}
          <RemixIcon
            icon={ChevronRightIcon}
            size={13}
            class="transition-transform duration-[var(--dur-hover)] group-hover:translate-x-0.5"
          />
        </button>
      </Show>
    </div>
  )
}

export function SkeletonRows(props: { count: number; grid?: boolean }) {
  return (
    <div
      class={props.grid ? "grid grid-cols-1 gap-3 @min-[640px]/page:grid-cols-2" : "flex flex-col gap-2"}
      aria-hidden="true"
      data-component="skeleton-rows"
    >
      <For each={Array.from({ length: props.count })}>
        {() => (
          <div class="flex items-center gap-3 rounded-2xl bg-panel p-4">
            <span class="motion-skeleton size-10 shrink-0 rounded-[12px]" />
            <span class="flex flex-1 flex-col gap-2">
              <span class="motion-skeleton h-3.5 w-1/3 rounded-control" />
              <span class="motion-skeleton h-3 w-2/3 rounded-control" />
            </span>
          </div>
        )}
      </For>
    </div>
  )
}
