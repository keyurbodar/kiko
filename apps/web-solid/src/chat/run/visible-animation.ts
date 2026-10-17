/*
 * A port of t3code's `observeVisibleAnimation` (apps/web/src/lib/visibleAnimation.ts). An element
 * that shines runs its animation only while it is on screen, the tab is visible, and the reader
 * has not asked for reduced motion. It sets `--visible-animation-state` and
 * `--visible-animation-will-change` for the CSS to read. All elements share one observer.
 */

type Observed = { element: HTMLElement | SVGElement; intersecting: boolean }

const observed = new Map<Element, Observed>()
let observer: IntersectionObserver | null = null
let reducedMotion: MediaQueryList | null = null

function update(animation: Observed) {
  const running = animation.intersecting && document.visibilityState === "visible" && !reducedMotion?.matches
  animation.element.style.setProperty("--visible-animation-state", running ? "running" : "paused")
  animation.element.style.setProperty("--visible-animation-will-change", running ? "transform" : "auto")
}

const updateAll = () => {
  for (const animation of observed.values()) update(animation)
}

/** Attach to a stable animation container. Returns the call that detaches it. */
export function observeVisibleAnimation(element: HTMLElement | SVGElement | null): (() => void) | undefined {
  if (element === null) return undefined
  element.style.setProperty("--visible-animation-state", "paused")
  element.style.setProperty("--visible-animation-will-change", "auto")
  if (typeof IntersectionObserver === "undefined") return undefined

  if (observer === null) {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    reducedMotion.addEventListener("change", updateAll)
    document.addEventListener("visibilitychange", updateAll)
    observer = new IntersectionObserver((entries, source) => {
      if (source !== observer) return
      for (const entry of entries) {
        const animation = observed.get(entry.target)
        if (!animation) continue
        animation.intersecting = entry.isIntersecting
        update(animation)
      }
    })
  }

  const animation: Observed = { element, intersecting: false }
  observed.set(element, animation)
  observer.observe(element)

  return () => {
    if (observed.get(element) !== animation) return
    observed.delete(element)
    observer?.unobserve(element)
    element.style.setProperty("--visible-animation-state", "paused")
    element.style.setProperty("--visible-animation-will-change", "auto")
    if (observed.size === 0) {
      observer?.disconnect()
      observer = null
      reducedMotion?.removeEventListener("change", updateAll)
      reducedMotion = null
      document.removeEventListener("visibilitychange", updateAll)
    }
  }
}
