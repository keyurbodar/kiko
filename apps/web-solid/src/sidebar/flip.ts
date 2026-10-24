import { createEffect, on } from "solid-js"

const MAX_TRAVEL = 480

export function flipRows(root: () => HTMLElement | undefined, order: () => readonly string[]): void {
  let last = new Map<string, number>()
  const positions = (el: HTMLElement) => {
    const next = new Map<string, number>()
    for (const row of el.querySelectorAll<HTMLElement>("[data-chat-id]")) {
      const id = row.dataset.chatId
      if (id) next.set(id, row.offsetTop)
    }
    return next
  }
  createEffect(
    on(order, () => {
      const el = root()
      if (!el) return
      const next = positions(el)
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
      if (!calm && last.size > 0) {
        for (const row of el.querySelectorAll<HTMLElement>("[data-chat-id]")) {
          const id = row.dataset.chatId ?? ""
          const from = last.get(id)
          const to = next.get(id)
          if (from === undefined || to === undefined) continue
          const delta = from - to
          if (delta === 0 || Math.abs(delta) > MAX_TRAVEL) continue
          row.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], {
            duration: 260,
            easing: "cubic-bezier(.2,.8,.2,1)",
          })
        }
      }
      last = next
    }),
  )
}
