import "./tooltip-v2.css"
import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import { createEffect, Match, onCleanup, splitProps, Switch, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"

const OPEN_DELAY_MS = 300
const CLOSE_DELAY_MS = 100
const HANDOFF_MS = 200
let lastClosedAt = Number.NEGATIVE_INFINITY
let openTips = 0
const warm = () => openTips > 0 || performance.now() - lastClosedAt < HANDOFF_MS

export interface TooltipV2Props extends ComponentProps<typeof KobalteTooltip> {
  value: JSX.Element
  class?: string
  contentClass?: string
  contentStyle?: JSX.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
}

export function TooltipV2(props: TooltipV2Props) {
  let ref: HTMLDivElement | undefined
  const [state, setState] = createStore({
    open: false,
    block: false,
    expand: false,
    instant: false,
  })
  const [local, others] = splitProps(props, [
    "children",
    "class",
    "contentClass",
    "contentStyle",
    "inactive",
    "forceOpen",
    "ignoreSafeArea",
    "value",
  ])

  let closing: ReturnType<typeof setTimeout> | undefined
  const cancelClose = () => {
    clearTimeout(closing)
    closing = undefined
  }

  const show = (open: boolean) => {
    cancelClose()
    if (open === state.open) return
    if (open) {
      setState("instant", warm())
      openTips += 1
    } else {
      openTips -= 1
      lastClosedAt = performance.now()
    }
    setState("open", open)
  }

  const close = () => show(false)

  const closeSoon = () => {
    cancelClose()
    closing = setTimeout(close, CLOSE_DELAY_MS)
  }

  onCleanup(() => {
    cancelClose()
    if (!state.open) return
    openTips -= 1
    lastClosedAt = performance.now()
  })

  const inside = () => {
    const active = document.activeElement
    if (!ref || !active) return false
    return ref.contains(active)
  }

  const invited = () => !!ref?.matches(":hover") || (inside() && document.activeElement!.matches(":focus-visible"))

  const drop = (expand = state.expand) => {
    if (expand) return
    if (ref?.matches(":hover")) return
    if (inside()) return
    setState("block", false)
  }

  const sync = () => {
    const expand = !!ref?.querySelector('[aria-expanded="true"], [data-expanded]')
    setState("expand", expand)
    if (expand) {
      setState("block", true)
      close()
      return
    }
    drop(expand)
  }

  const arm = () => {
    setState("block", true)
    close()
  }

  const leave = () => {
    if (!inside()) closeSoon()
    drop()
  }

  createEffect(() => {
    if (!state.open || local.forceOpen) return
    const shut = () => close()
    const left = (event: PointerEvent) => {
      if (event.relatedTarget === null) close()
    }
    const hidden = () => {
      if (document.hidden) close()
    }
    window.addEventListener("blur", shut)
    document.addEventListener("pointerout", left)
    document.addEventListener("visibilitychange", hidden)
    onCleanup(() => {
      window.removeEventListener("blur", shut)
      document.removeEventListener("pointerout", left)
      document.removeEventListener("visibilitychange", hidden)
    })
  })

  createEffect(() => {
    if (!ref) return
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(ref, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded"],
    })
    onCleanup(() => obs.disconnect())
  })

  let justClickedTrigger = false

  return (
    <Switch>
      <Match when={local.inactive}>{local.children}</Match>
      <Match when={true}>
        <KobalteTooltip
          gutter={4}
          overflowPadding={5}
          skipDelayDuration={HANDOFF_MS}
          {...others}
          openDelay={warm() ? 0 : (others.openDelay ?? OPEN_DELAY_MS)}
          closeDelay={CLOSE_DELAY_MS}
          ignoreSafeArea={local.ignoreSafeArea ?? true}
          open={local.forceOpen || state.open}
          onOpenChange={(open) => {
            if (local.forceOpen) return
            if (state.block && open) return
            if (open && !invited()) return
            if (justClickedTrigger) {
              justClickedTrigger = false
              return
            }
            show(open)
          }}
        >
          <KobalteTooltip.Trigger
            ref={ref}
            as="div"
            data-component="tooltip-v2-trigger"
            class={local.class}
            onPointerDownCapture={arm}
            onKeyDownCapture={(event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return
              arm()
            }}
            onPointerEnter={cancelClose}
            onPointerLeave={leave}
            onFocusOut={() => requestAnimationFrame(() => drop())}
          >
            {local.children}
          </KobalteTooltip.Trigger>
          <KobalteTooltip.Portal>
            <KobalteTooltip.Content
              data-component="tooltip-v2"
              data-placement={props.placement}
              data-force-open={local.forceOpen}
              data-instant={state.instant ? "" : undefined}
              class={local.contentClass}
              style={local.contentStyle}
              onPointerDownOutside={(e) => {
                if (ref === e.target || (e.target instanceof Node && ref?.contains(e.target))) {
                  justClickedTrigger = true
                }
                e.preventDefault()
              }}
            >
              {local.value}
            </KobalteTooltip.Content>
          </KobalteTooltip.Portal>
        </KobalteTooltip>
      </Match>
    </Switch>
  )
}
