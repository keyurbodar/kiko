import "./shine.css"

type Observed = { element: HTMLElement | SVGElement; intersecting: boolean; seen: boolean }

const observed = new Map<Element, Observed>()
let observer: IntersectionObserver | null = null
let reducedMotion: MediaQueryList | null = null

function paint(element: HTMLElement | SVGElement, running: boolean) {
  element.style.setProperty("--visible-animation-state", running ? "running" : "paused")
  element.style.setProperty("--visible-animation-will-change", running ? "transform" : "auto")
}

function update(animation: Observed) {
  const running = animation.intersecting && document.visibilityState === "visible" && !reducedMotion?.matches
  paint(animation.element, running)
}

const updateAll = () => {
  for (const animation of observed.values()) update(animation)
}

function teardown() {
  observer?.disconnect()
  observer = null
  reducedMotion?.removeEventListener("change", updateAll)
  reducedMotion = null
  document.removeEventListener("visibilitychange", updateAll)
}

function release(element: Element, animation: Observed): boolean {
  if (observed.get(element) !== animation) return false
  observed.delete(element)
  observer?.unobserve(element)
  paint(animation.element, false)
  if (observed.size === 0) teardown()
  return true
}

function connect(): IntersectionObserver {
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
  reducedMotion.addEventListener("change", updateAll)
  document.addEventListener("visibilitychange", updateAll)
  observer = new IntersectionObserver((entries, source) => {
    if (source !== observer) return
    for (const entry of entries) {
      const animation = observed.get(entry.target)
      if (!animation) continue
      if (!entry.target.isConnected) {
        if (animation.seen) release(entry.target, animation)
        continue
      }
      animation.seen = true
      animation.intersecting = entry.isIntersecting
      update(animation)
    }
  })
  return observer
}

export function observeVisibleAnimation(element: HTMLElement | SVGElement | null): (() => void) | undefined {
  if (element === null) return undefined
  paint(element, false)
  if (typeof IntersectionObserver === "undefined") return undefined
  const source = observer ?? connect()
  const animation: Observed = { element, intersecting: false, seen: false }
  observed.set(element, animation)
  source.observe(element)
  return () => {
    release(element, animation)
  }
}
