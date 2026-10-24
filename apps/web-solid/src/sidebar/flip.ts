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
          const rising = delta > 0
          const frames: Keyframe[] = rising
            ? [
                { transform: `translateY(${delta}px)` },
                { transform: "translateY(-3px)", offset: 0.7 },
                { transform: "none" },
              ]
            : [{ transform: `translateY(${delta}px)` }, { transform: "none" }]
          row.animate(frames, {
            duration: rising ? 320 : 260,
            easing: "cubic-bezier(.2,.8,.2,1)",
          })
        }
      }
      last = next
    }),
  )
}

const GLIDE_MS = 200

export function glideActive(root: () => HTMLElement | undefined, active: () => string | null): void {
  createEffect(
    on(active, (id, prev) => {
      const el = root()
      if (!el || !id || !prev || id === prev) return
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
      const from = el.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(prev)}"]`)
      const to = el.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(id)}"]`)
      if (!from || !to) return
      const base = el.getBoundingClientRect()
      const a = from.getBoundingClientRect()
      const b = to.getBoundingClientRect()
      if (a.height === 0 || b.height === 0 || Math.abs(a.top - b.top) > MAX_TRAVEL) return
      const ghost = document.createElement("span")
      ghost.className = "chat-glide"
      ghost.setAttribute("aria-hidden", "true")
      Object.assign(ghost.style, {
        top: `${b.top - base.top + el.scrollTop}px`,
        left: `${b.left - base.left}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
      })
      el.prepend(ghost)
      to.dataset.gliding = ""
      const settle = () => {
        to.style.transition = "none"
        delete to.dataset.gliding
        void getComputedStyle(to).backgroundColor
        to.style.transition = ""
        ghost.remove()
      }
      ghost
        .animate([{ transform: `translateY(${a.top - b.top}px)` }, { transform: "none" }], {
          duration: GLIDE_MS,
          easing: "cubic-bezier(.2,.8,.2,1)",
        })
        .finished.then(settle, settle)
    }),
  )
}
