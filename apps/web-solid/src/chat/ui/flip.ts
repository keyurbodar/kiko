/*
 * A picture grows out of its thumbnail and shrinks back into it: the viewport is moved and scaled
 * to the thumbnail's box and released to its own, as a web animation. The box is matched by width
 * and centred, so a cropped thumbnail and the whole picture line up at their middles. Nothing
 * waits on it: the lightbox takes clicks and keys from its first frame.
 */

export const FLIP_MS = 200
const ENTER = "cubic-bezier(0.22, 1, 0.36, 1)"
const LEAVE = "cubic-bezier(0.4, 0, 0.2, 1)"

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

type Box = { left: number; top: number; width: number; height: number }

/** The transform that puts `box` (the picture's own place) over `thumb`. */
export function flipTransform(box: Box, thumb: Box): string {
  const scale = thumb.width / (box.width || 1)
  const dx = thumb.left + thumb.width / 2 - (box.left + box.width / 2)
  const dy = thumb.top + thumb.height / 2 - (box.top + box.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${scale})`
}

export function flip(element: HTMLElement, thumb: Box, direction: "in" | "out"): void {
  if (reducedMotion()) return
  const box = element.getBoundingClientRect()
  if (!box.width || !thumb.width) return
  const away = flipTransform(box, thumb)
  element.animate(direction === "in" ? [{ transform: away }, { transform: "none" }] : [{ transform: "none" }, { transform: away }], {
    duration: FLIP_MS,
    easing: direction === "in" ? ENTER : LEAVE,
    fill: "both",
  })
}
