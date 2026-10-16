import { createUniqueId } from "solid-js"

/**
 * The art behind the sidebar's brand and search rows, drawn from the app icon: a blueprint grid,
 * corner crosshairs, and a dashed orbit with a small planet. Every color is a theme token, so it
 * follows the accent, the appearance, and an imported theme. The grid is in pixels, so a wider
 * sidebar shows more of it instead of zooming.
 */
export function BrandArt() {
  const id = createUniqueId()
  return (
    <div class="brand-art" data-component="sidebar-brand-art" aria-hidden="true">
      <svg class="brand-art-grid" width="100%" height="100%" fill="none">
        <defs>
          <pattern id={`${id}-minor`} width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" class="brand-art-line" stroke-opacity="0.07" stroke-width="0.5" />
          </pattern>
          <pattern id={`${id}-major`} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" class="brand-art-line" stroke-opacity="0.12" stroke-width="0.6" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id}-minor)`} />
        <rect width="100%" height="100%" fill={`url(#${id}-major)`} />
        <path d="M6 8h5M8.5 5.5v5" class="brand-art-line" stroke-opacity="0.4" stroke-width="0.7" />
      </svg>
      <svg class="brand-art-orbit" viewBox="0 0 160 160" fill="none">
        <path d="M80 0V160M0 80H160" class="brand-art-line" stroke-opacity="0.1" stroke-width="0.6" />
        <circle cx="80" cy="80" r="38" class="brand-art-line" stroke-opacity="0.16" stroke-width="0.6" stroke-dasharray="2 3" />
        <circle cx="80" cy="80" r="62" class="brand-art-line" stroke-opacity="0.32" stroke-width="0.7" stroke-dasharray="3 3.4" />
        <circle cx="21.7" cy="101.2" r="7" class="brand-art-halo" />
        <circle cx="21.7" cy="101.2" r="2.6" class="brand-art-planet" />
      </svg>
    </div>
  )
}
