import { RemixIcon, type Glyph } from "@kiko/ui/remix-icon"
import { ChevronRightIcon, CloseIcon, SearchIcon } from "@kiko/ui/icons"
import { createEffect, createSignal, For, type JSX, on, onCleanup, onMount, Show } from "solid-js"
import { cn } from "../lib/cn"
import { pageIn } from "../lib/motion"
import "./page-ui.css"

export function PageFrame(props: { title: string; children: JSX.Element }) {
  return (
    <div
      class="@container/page flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-chrome"
      data-component="page-frame"
    >
      <div
        ref={pageIn}
        class="mx-auto flex w-full max-w-[960px] flex-col px-6 pt-4 pb-16 max-[767px]:pt-12 @min-[768px]/page:px-12 @min-[768px]/page:pt-6"
      >
        <header class="flex h-10 shrink-0 items-center">
          <h1 class="type-lg min-w-0 truncate font-semibold text-primary">{props.title}</h1>
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
        props.quiet ? "gap-px rounded-lg bg-quinary p-0.5" : "gap-px",
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
              "page-tabs-pill absolute top-0 left-0 rounded-base bg-quaternary",
              props.quiet ? "top-0.5 h-[calc(100%-4px)]" : "h-full",
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
            class="type-base relative z-[1] flex h-control-md cursor-pointer items-center gap-1.5 rounded-base px-2 text-secondary transition-colors duration-(--duration-fast) hover:text-primary aria-selected:text-primary"
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

export const toolButton =
  "grid size-6 shrink-0 cursor-pointer place-items-center rounded-base icon-secondary transition-[background-color,color,transform] duration-(--duration-fast) hover:bg-tertiary hover:icon-primary active:scale-(--press-scale) aria-pressed:bg-quaternary aria-pressed:icon-primary"

export const primaryButton =
  "type-base flex h-control-md shrink-0 cursor-pointer items-center gap-1.5 rounded-base bg-neutral px-2 font-medium text-invert transition-[background-color,transform] duration-(--duration-fast) hover:bg-neutral-hover active:scale-(--press-scale)"

export const secondaryButton =
  "type-base flex h-control-md shrink-0 cursor-pointer items-center gap-1.5 rounded-base bg-tertiary px-2 text-primary transition-[background-color,transform] duration-(--duration-fast) hover:bg-secondary active:scale-(--press-scale)"

export function PageSearch(props: { label: string; query: string; onQuery: (query: string) => void }) {
  const [open, setOpen] = createSignal(false)
  let input: HTMLInputElement | undefined
  const toggle = () => {
    const next = !open()
    setOpen(next)
    if (next) queueMicrotask(() => input?.focus())
    else props.onQuery("")
  }
  return (
    <>
      <Show when={open()}>
        <label class="motion-page-in flex h-control-md w-[min(220px,40vw)] items-center gap-1.5 rounded-base border border-tertiary bg-input-field px-2 icon-tertiary transition-colors duration-(--duration-fast) focus-within:border-primary">
          <RemixIcon icon={SearchIcon} size={13} />
          <input
            ref={input}
            type="search"
            class="type-base min-w-0 flex-1 bg-transparent text-primary outline-none placeholder:text-tertiary"
            placeholder={props.label}
            aria-label={props.label}
            value={props.query}
            onInput={(e) => props.onQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Escape" && toggle()}
          />
        </label>
      </Show>
      <ToolButton
        label={open() ? "Close search" : props.label}
        icon={open() ? CloseIcon : SearchIcon}
        onClick={toggle}
      />
    </>
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
      class={toolButton}
      onClick={() => props.onClick?.()}
    >
      <RemixIcon icon={props.icon} size={13} />
    </button>
  )
}

export function SectionHead(props: { title: string; count?: number; onAll?: () => void; allLabel?: string }) {
  return (
    <div class="flex min-h-sidebar-group-label items-center justify-between gap-3">
      <h2 class="type-sm flex items-baseline gap-1.5 text-tertiary">
        {props.title}
        <Show when={props.count !== undefined}>
          <span class="type-sm text-quaternary">{props.count}</span>
        </Show>
      </h2>
      <Show when={props.onAll}>
        <button
          type="button"
          class="group type-sm flex cursor-pointer items-center gap-1 rounded-sm text-tertiary transition-colors duration-(--duration-fast) hover:text-primary"
          onClick={props.onAll}
        >
          {props.allLabel ?? "Show all"}
          <RemixIcon
            icon={ChevronRightIcon}
            size={12}
            class="transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
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
          <div class="flex items-center gap-3 rounded-xl border border-tertiary bg-editor p-3">
            <span class="motion-skeleton size-8 shrink-0 rounded-lg" />
            <span class="flex flex-1 flex-col gap-1.5">
              <span class="motion-skeleton h-3 w-1/3 rounded-sm" />
              <span class="motion-skeleton h-2.5 w-2/3 rounded-sm" />
            </span>
          </div>
        )}
      </For>
    </div>
  )
}
