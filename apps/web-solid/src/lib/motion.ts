import { onMount } from "solid-js"

let interacted = false
let entering = false

if (typeof window !== "undefined") {
  const mark = () => (interacted = true)
  window.addEventListener("pointerdown", mark, { capture: true, once: true })
  window.addEventListener("keydown", mark, { capture: true, once: true })
}

export function pageIn(el: HTMLElement) {
  if (!interacted || entering) return
  entering = true
  queueMicrotask(() => (entering = false))
  el.classList.add("motion-page-in")
}

export function afterFirstPaint(): () => boolean {
  let painted = false
  onMount(() => requestAnimationFrame(() => (painted = true)))
  return () => painted
}

export function replay(el: HTMLElement | undefined) {
  if (!el) return
  el.classList.remove("motion-page-in")
  void el.offsetWidth
  el.classList.add("motion-page-in")
}

export function look(el: HTMLElement) {
  let frame = 0
  let x = 0
  const aim = (event: PointerEvent) => {
    x = event.clientX
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const face = el.querySelector<HTMLElement>('[data-component="identity-avatar"]')
      if (!face) return
      const box = face.getBoundingClientRect()
      const reach = Math.max(box.width * 3, 1)
      const dx = (x - (box.left + box.width / 2)) / reach
      el.style.setProperty("--look", Math.max(-1, Math.min(1, dx)).toFixed(2))
    })
  }
  el.setAttribute("data-look", "")
  el.addEventListener("pointermove", aim)
  return () => {
    cancelAnimationFrame(frame)
    el.removeEventListener("pointermove", aim)
  }
}
