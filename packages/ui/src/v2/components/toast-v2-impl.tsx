import { isRTL } from "@kobalte/core/i18n"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useI18n } from "../../context/i18n"
import {
  ERROR_CLAMP_CHARS,
  placeToast,
  stackLayout,
  swipeDamp,
  swipeOutcome,
  toastDuration,
  type ToastSlot,
  type ToastV2Variant,
} from "./toast-v2-logic"
import "./toast-v2.css"

/*
 * Yuki's toaster, after t3code's (MIT, apps/web/src/components/ui/toast.tsx on Base UI's
 * toast): a glass card at the top right under the top bar, a stack of three that fans out on
 * hover or focus, a dismiss orb on the corner, and small toasts anchored to the control that
 * raised them. Alt+T focuses the newest toast and Escape dismisses the focused one.
 */

export type { ToastV2Variant }

export interface ToastV2Action {
  label: string
  variant?: "primary" | "secondary"
  onClick: "dismiss" | (() => void)
}

export interface ToastV2Options {
  title?: string
  description?: string
  icon?: JSX.Element
  variant?: ToastV2Variant
  /* Milliseconds before it closes on its own. Zero keeps it until dismissed. */
  duration?: number
  persistent?: boolean
  action?: ToastV2Action
  actions?: ToastV2Action[]
  /* Shows a small toast next to this element instead of in the stack, as t3code's copy buttons do. */
  anchor?: Element
}

export interface ToastV2RegionProps {
  class?: string
}

type Ending = "close" | "out-x" | "out-y"

interface ToastItem {
  id: number
  key: string
  options: ToastV2Options
  /* Bumped by every update, which restarts the timer. */
  version: number
  ending?: Ending
  anchor?: { x: number; top: number; bottom: number }
}

const EXIT_MS = 200

const [toasts, setToasts] = createStore<ToastItem[]>([])
let lastId = 0

const toastKey = (options: ToastV2Options) =>
  JSON.stringify([
    options.title,
    options.description,
    options.variant,
    options.duration,
    options.persistent,
    actionsOf(options).map((action) => [action.label, action.variant]),
    Boolean(options.anchor),
  ])

const actionsOf = (options: ToastV2Options) => [...(options.action ? [options.action] : []), ...(options.actions ?? [])]

const anchorOf = (element: Element | undefined) => {
  if (!element) return undefined
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
}

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

/* Shows a toast and returns its id. The same toast again refreshes the one on screen. */
export function showToastV2(input: ToastV2Options | string): number {
  const options = typeof input === "string" ? { title: input } : input
  const key = toastKey(options)
  const placement = placeToast(
    toasts.filter((toast) => !toast.ending && Boolean(toast.anchor) === Boolean(options.anchor)),
    key,
  )
  if (placement.kind === "refresh") {
    updateToastV2(placement.id, options)
    pulse(placement.id)
    return placement.id
  }
  if (placement.kind === "replace") dismissToastV2(placement.id)
  const id = ++lastId
  setToasts((list) => [{ id, key, options, version: 0, anchor: anchorOf(options.anchor) }, ...list])
  return id
}

/* Replaces a toast's content and restarts its timer, as when a loading toast gets its result. */
export function updateToastV2(id: number, options: ToastV2Options) {
  setToasts(
    (toast) => toast.id === id && !toast.ending,
    produce((toast) => {
      toast.options = options
      toast.key = toastKey(options)
      toast.version += 1
      if (options.anchor) toast.anchor = anchorOf(options.anchor)
    }),
  )
}

/* Closes one toast, or every toast when no id is given. */
export function dismissToastV2(id?: number, ending: Ending = "close") {
  const closing = toasts.filter((toast) => !toast.ending && (id === undefined || toast.id === id)).map((toast) => toast.id)
  if (!closing.length) return
  setToasts((toast) => closing.includes(toast.id), "ending", ending)
  setTimeout(() => setToasts((list) => list.filter((toast) => !closing.includes(toast.id))), reducedMotion() ? 0 : EXIT_MS)
}

type ToastV2Step<T> = string | ToastV2Options | ((value: T) => string | ToastV2Options)

export interface ToastV2PromiseOptions<T> {
  loading: string | ToastV2Options
  success: ToastV2Step<T>
  error: ToastV2Step<unknown>
}

/* A loading toast that becomes the success or error toast when the promise settles. */
export function promiseToastV2<T>(promise: Promise<T>, steps: ToastV2PromiseOptions<T>): Promise<T> {
  const asOptions = (step: string | ToastV2Options) => (typeof step === "string" ? { title: step } : step)
  const id = showToastV2({ ...asOptions(steps.loading), variant: "loading" })
  const settle = <V,>(step: ToastV2Step<V>, value: V, variant: ToastV2Variant) =>
    updateToastV2(id, { variant, ...asOptions(typeof step === "function" ? step(value) : step) })
  promise.then(
    (value) => settle(steps.success, value, "success"),
    (error: unknown) => settle(steps.error, error, "error"),
  )
  return promise
}

/* A toast shown again is nudged, so the repeat reads as heard. */
function pulse(id: number) {
  if (typeof requestAnimationFrame === "undefined" || reducedMotion()) return
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-toast-v2-id="${id}"]`)
      ?.animate([{ scale: "1" }, { scale: "1.025" }, { scale: "1" }], { duration: 160, easing: "ease-out" })
  })
}

/* Runs a toast's timer, held while `paused` is true, and restarted by each update. */
function autoDismiss(toast: ToastItem, paused: () => boolean, close: () => void) {
  createEffect(
    on(
      () => toast.version,
      () => {
        let remaining = toastDuration({ ...toast.options, anchored: Boolean(toast.anchor) })
        if (!Number.isFinite(remaining)) return
        let started: number | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        createEffect(() => {
          if (paused() || toast.ending) {
            if (started === undefined) return
            remaining -= Date.now() - started
            started = undefined
            clearTimeout(timer)
            return
          }
          if (started !== undefined) return
          started = Date.now()
          timer = setTimeout(close, Math.max(0, remaining))
        })
        onCleanup(() => clearTimeout(timer))
      },
    ),
  )
}

function ToastV2Region(props: ToastV2RegionProps) {
  const i18n = useI18n()
  const side = () => (isRTL(i18n.locale()) ? "left" : "right")
  const [hovered, setHovered] = createSignal(false)
  const [focused, setFocused] = createSignal(false)
  const [pressed, setPressed] = createSignal(false)
  const [windowActive, setWindowActive] = createSignal(true)
  const [heights, setHeights] = createStore<Record<number, number>>({})
  const stack = createMemo(() => toasts.filter((toast) => !toast.anchor))
  const anchored = createMemo(() => toasts.filter((toast) => toast.anchor))
  const layout = createMemo(() =>
    stackLayout(stack().map((toast) => ({ id: toast.id, height: heights[toast.id] ?? 0, ending: Boolean(toast.ending) }))),
  )
  const live = () => stack().some((toast) => !toast.ending)
  const expanded = () => hovered() || focused()
  const paused = () => expanded() || pressed() || !windowActive()
  let list: HTMLOListElement | undefined
  let returnFocus: HTMLElement | null = null

  const focusFront = () => {
    const front = list?.querySelector<HTMLElement>("[data-toast-v2-id]:not([data-ending]):not([data-limited])")
    front?.focus()
    return front
  }

  /* Closes a toast, and keeps focus in the region, or gives it back, if it was there. */
  const close = (id: number, ending: Ending = "close") => {
    const hadFocus = Boolean(list?.contains(document.activeElement))
    dismissToastV2(id, ending)
    if (!hadFocus || focusFront()) return
    setFocused(false)
    returnFocus?.focus({ preventScroll: true })
    returnFocus = null
  }

  createEffect(() => {
    if (live()) return
    setHovered(false)
    setFocused(false)
  })

  onMount(() => {
    const release = () => setPressed(false)
    const sync = () => setWindowActive(document.visibilityState === "visible" && document.hasFocus())
    const keydown = (event: KeyboardEvent) => {
      if (!event.altKey || event.code !== "KeyT" || !live()) return
      event.preventDefault()
      if (!list?.contains(document.activeElement)) returnFocus = document.activeElement as HTMLElement | null
      focusFront()
    }
    sync()
    document.addEventListener("visibilitychange", sync)
    window.addEventListener("focus", sync)
    window.addEventListener("blur", sync)
    document.addEventListener("keydown", keydown)
    window.addEventListener("pointerup", release)
    onCleanup(() => {
      window.removeEventListener("pointerup", release)
      document.removeEventListener("visibilitychange", sync)
      window.removeEventListener("focus", sync)
      window.removeEventListener("blur", sync)
      document.removeEventListener("keydown", keydown)
    })
  })

  return (
    <Portal>
      <section
        class={["toast-v2-region", props.class].filter(Boolean).join(" ")}
        aria-label="Notifications alt+T"
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic="false"
        tabIndex={-1}
        data-side={side()}
        data-expanded={expanded() || undefined}
        style={{ "--toast-front-height": `${layout().frontHeight}px` }}
      >
        <ol
          ref={list}
          class="toast-v2-list"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onPointerDown={() => setPressed(true)}
          onPointerCancel={() => setPressed(false)}
          onFocusIn={() => setFocused(true)}
          onFocusOut={(event) => {
            if (!list?.contains(event.relatedTarget as Node | null)) setFocused(false)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            const card = (event.target as Element).closest<HTMLElement>("[data-toast-v2-id]")
            const id = card ? Number(card.dataset.toastV2Id) : stack().find((toast) => !toast.ending)?.id
            if (id === undefined) return
            event.preventDefault()
            event.stopPropagation()
            close(id)
          }}
        >
          <For each={stack()}>
            {(toast) => (
              <ToastCard
                toast={toast}
                slot={layout().slots.get(toast.id)}
                outward={side() === "right" ? 1 : -1}
                paused={paused}
                close={(ending) => close(toast.id, ending)}
                onHeight={(height) => setHeights(toast.id, height)}
                onRemoved={() => setHeights(produce((all) => delete all[toast.id]))}
              />
            )}
          </For>
        </ol>
      </section>
      <div class="toast-v2-anchors" aria-live="polite">
        <For each={anchored()}>{(toast) => <AnchoredToast toast={toast} />}</For>
      </div>
    </Portal>
  )
}

function ToastCard(props: {
  toast: ToastItem
  slot: ToastSlot | undefined
  outward: 1 | -1
  paused: () => boolean
  close: (ending?: Ending) => void
  onHeight: (height: number) => void
  onRemoved: () => void
}) {
  const i18n = useI18n()
  const options = () => props.toast.options
  const variant = () => options().variant ?? "default"
  const actions = () => actionsOf(options())
  const limited = () => props.slot?.limited ?? false
  const icon = createMemo(() => options().icon ?? VARIANT_ICONS[variant()]?.())
  const clamp = () =>
    variant() === "error" && (options().description?.length ?? 0) >= ERROR_CLAMP_CHARS ? "" : undefined
  const [swiping, setSwiping] = createSignal(false)
  let card!: HTMLLIElement
  let content!: HTMLDivElement
  let start: { x: number; y: number } | undefined
  let axis: "x" | "y" | null = null
  let dx = 0
  let dy = 0

  autoDismiss(props.toast, () => props.paused() || limited(), () => props.close())

  onMount(() => {
    const observer = new ResizeObserver(() => props.onHeight(content.offsetHeight))
    observer.observe(content)
    onCleanup(() => {
      observer.disconnect()
      props.onRemoved()
    })
  })

  createEffect(() => {
    card.inert = limited()
  })

  const setSwipe = (x: number, y: number) => {
    card.style.setProperty("--toast-swipe-x", `${x}px`)
    card.style.setProperty("--toast-swipe-y", `${y}px`)
  }

  const endSwipe = () => {
    start = undefined
    setSwiping(false)
    const outcome = swipeOutcome(axis, dx, dy, props.outward)
    if (outcome) return props.close(outcome)
    dx = dy = 0
    setSwipe(0, 0)
  }

  return (
    <li
      ref={card}
      class="toast-v2"
      role={variant() === "error" ? "alert" : "status"}
      aria-atomic="true"
      tabIndex={limited() ? -1 : 0}
      data-toast-v2-id={props.toast.id}
      data-variant={variant()}
      data-behind={(props.slot?.index ?? 0) > 0 || undefined}
      data-limited={limited() || undefined}
      data-ending={props.toast.ending}
      data-swiping={swiping() || undefined}
      style={{ "--toast-index": props.slot?.index ?? 0, "--toast-offset-y": `${props.slot?.offset ?? 0}px` }}
      onPointerDown={(event) => {
        /* Swipe to dismiss is for touch. A mouse selects text and has the dismiss orb. */
        if (event.pointerType === "mouse" || (event.target as Element).closest("button")) return
        start = { x: event.clientX, y: event.clientY }
        axis = null
        card.setPointerCapture(event.pointerId)
        setSwiping(true)
      }}
      onPointerMove={(event) => {
        if (!start) return
        const x = event.clientX - start.x
        const y = event.clientY - start.y
        if (!axis && (Math.abs(x) > 1 || Math.abs(y) > 1)) axis = Math.abs(x) > Math.abs(y) ? "x" : "y"
        dx = axis === "x" ? swipeDamp(x, x * props.outward > 0) : 0
        dy = axis === "y" ? swipeDamp(y, y < 0) : 0
        setSwipe(dx, dy)
      }}
      onPointerUp={() => start && endSwipe()}
      onPointerCancel={() => {
        if (!start) return
        axis = null
        endSwipe()
      }}
    >
      <button
        type="button"
        class="toast-v2-close"
        aria-label={i18n.t("ui.common.dismiss")}
        onClick={() => props.close()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" stroke-width="2.25">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
      <div ref={content} class="toast-v2-content" data-actions={actions().length > 0 || undefined}>
        <div class="toast-v2-body">
          <Show when={options().title || icon()}>
            <div class="toast-v2-head">
              <Show when={icon()}>
                <span class="toast-v2-icon">{icon()}</span>
              </Show>
              <div class="toast-v2-title">{options().title}</div>
            </div>
          </Show>
          <Show when={options().description}>
            <div class="toast-v2-description" data-clamp={clamp()}>
              {options().description}
            </div>
          </Show>
        </div>
        <Show when={actions().length > 0}>
          <div class="toast-v2-actions">
            <For each={actions()}>
              {(action) => (
                <button
                  type="button"
                  class="toast-v2-action"
                  data-variant={action.variant ?? "primary"}
                  onClick={() => {
                    if (typeof action.onClick === "function") action.onClick()
                    props.close()
                  }}
                >
                  {action.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </li>
  )
}

/* t3code's tooltip-style anchored toast: one line, above the control, or below it near the top. */
function AnchoredToast(props: { toast: ToastItem }) {
  autoDismiss(props.toast, () => false, () => dismissToastV2(props.toast.id))
  const anchor = () => props.toast.anchor!
  const below = () => anchor().top < 40
  return (
    <div
      class="toast-v2-anchored"
      role={props.toast.options.variant === "error" ? "alert" : "status"}
      data-side={below() ? "bottom" : "top"}
      data-ending={props.toast.ending}
      style={{ left: `${anchor().x}px`, top: `${below() ? anchor().bottom : anchor().top}px` }}
    >
      {props.toast.options.title}
    </div>
  )
}

/* Lucide's glyphs, as t3code draws them (ISC). */
const glyph = (paths: () => JSX.Element) => () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {paths()}
  </svg>
)

const VARIANT_ICONS: Partial<Record<ToastV2Variant, () => JSX.Element>> = {
  success: glyph(() => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  )),
  error: glyph(() => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  )),
  warning: glyph(() => (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  )),
  info: glyph(() => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  )),
  loading: glyph(() => <path d="M21 12a9 9 0 1 1-6.219-8.56" />),
}

export const ToastV2 = { Region: ToastV2Region }
