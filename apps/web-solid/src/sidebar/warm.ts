import { whenIdle } from "../lib/idle"
import { warmRoomSnapshots } from "../state/room"

const ids = new WeakMap<Element, () => string>()
let observer: IntersectionObserver | undefined

function connect(): IntersectionObserver {
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .flatMap((entry) => {
          const id = ids.get(entry.target)?.()
          if (id === undefined) return []
          observer?.unobserve(entry.target)
          return [id]
        })
      if (visible.length > 0) whenIdle(() => warmRoomSnapshots(visible))
    },
    { rootMargin: "160px" },
  )
  return observer
}

export function warmWhenSeen(element: Element, id: () => string): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {}
  ids.set(element, id)
  const source = observer ?? connect()
  source.observe(element)
  return () => {
    ids.delete(element)
    source.unobserve(element)
  }
}
