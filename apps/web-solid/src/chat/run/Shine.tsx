import { createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { cn } from "../../lib/cn"

export function Shine(props: { running: boolean; class?: string; children: JSX.Element }): JSX.Element {
  let element!: HTMLSpanElement
  const running = createMemo(() => props.running)
  createEffect(() => {
    if (!running()) return
    let off: (() => void) | undefined
    let stopped = false
    void import("./visible-animation").then(({ observeVisibleAnimation }) => {
      if (!stopped) off = observeVisibleAnimation(element)
    })
    onCleanup(() => {
      stopped = true
      off?.()
    })
  })
  return (
    <span ref={element} class={cn(props.class, running() && "motion-shine")}>
      {props.children}
    </span>
  )
}
