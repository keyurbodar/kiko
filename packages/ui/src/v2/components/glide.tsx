import { onCleanup } from "solid-js"

export type GlideOptions = {
  find: (host: HTMLElement) => HTMLElement | null | undefined
  attributes: string[]
  tone?: (target: HTMLElement) => string | undefined
}

function offsetIn(target: HTMLElement, host: HTMLElement) {
  let x = 0
  let y = 0
  let node: HTMLElement | null = target
  while (node && node !== host) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return node === host ? { x, y } : null
}

export function glide(host: HTMLElement, mark: HTMLElement, options: GlideOptions) {
  let shown = false
  let hiding = 0
  const hide = () => {
    hiding = 0
    mark.setAttribute("data-hidden", "")
    shown = false
  }
  const place = () => {
    const target = options.find(host)
    const at = target?.isConnected ? offsetIn(target, host) : null
    if (!target || !at) {
      if (shown && !hiding) hiding = requestAnimationFrame(hide)
      if (!shown) hide()
      return
    }
    cancelAnimationFrame(hiding)
    hiding = 0
    if (!shown) mark.setAttribute("data-jump", "")
    mark.style.transform = `translate(${at.x}px, ${at.y}px)`
    mark.style.width = `${target.offsetWidth}px`
    mark.style.height = `${target.offsetHeight}px`
    const tone = options.tone?.(target)
    if (tone) mark.setAttribute("data-tone", tone)
    else mark.removeAttribute("data-tone")
    mark.removeAttribute("data-hidden")
    if (!shown) {
      shown = true
      requestAnimationFrame(() => mark.removeAttribute("data-jump"))
    }
  }
  place()
  const mutations = new MutationObserver(place)
  mutations.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: options.attributes })
  const sizes = new ResizeObserver(() => {
    mark.setAttribute("data-jump", "")
    place()
    requestAnimationFrame(() => mark.removeAttribute("data-jump"))
  })
  sizes.observe(host)
  onCleanup(() => {
    cancelAnimationFrame(hiding)
    mutations.disconnect()
    sizes.disconnect()
  })
}
