const GLIDE_MS = 200

const expoOut = (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * t))

const endOf = (scroller: HTMLElement): number => scroller.scrollHeight - scroller.clientHeight

export function createGlide(element: () => HTMLElement | undefined) {
  let frame = 0

  const stop = () => {
    cancelAnimationFrame(frame)
    frame = 0
  }

  const toEnd = () => {
    const scroller = element()
    if (!scroller) return
    stop()
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      scroller.scrollTop = endOf(scroller)
      return
    }
    const lead = scroller.clientHeight
    if (endOf(scroller) - scroller.scrollTop > lead) scroller.scrollTop = endOf(scroller) - lead
    const from = scroller.scrollTop
    const start = performance.now()
    const step = () => {
      const t = Math.min((performance.now() - start) / GLIDE_MS, 1)
      const end = endOf(scroller)
      scroller.scrollTop = from + (end - from) * expoOut(t)
      frame = t < 1 ? requestAnimationFrame(step) : 0
    }
    frame = requestAnimationFrame(step)
  }

  return { toEnd, stop, active: () => frame !== 0 }
}
