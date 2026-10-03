import { birdSvg } from "./birds"

/**
 * The kiko bird as a standalone SVG document with real colours, for places CSS variables
 * cannot reach: the favicon, the boot screen, and files on disk. `hue` and `chroma` are the
 * theme's `--h-brand` and `--cm`.
 */
export function logoSvg(hue = 340, chroma = 1): string {
  const inner = birdSvg({ species: "kiko", tint: 0, accessory: "none" })
    .replaceAll("var(--h-brand, 340)", String(hue))
    .replaceAll("var(--cm, 1)", String(chroma))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 108 104">${inner}</svg>`
}

/** Points the tab icon at the bird in the current theme colour. A no-op without a DOM. */
export function setFavicon(hue: number, chroma: number): void {
  if (typeof document === "undefined" || !document.head) return
  const link = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(logoSvg(hue, chroma))}`
}
