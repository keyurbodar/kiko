import { createSignal } from "solid-js"

/*
 * A file's icon, as t3code draws it (`components/chat/PierreEntryIcon.tsx` and `pierre-icons.ts`):
 * the Pierre "complete" icon set, colored per token in a light and a dark tint. The set loads on
 * demand (entry-icon-pierre.ts). Until it lands, every file draws one neutral glyph of the same
 * size, so nothing moves when the icons arrive. Each icon is a `<use>` of the sprite.
 */

type Pierre = typeof import("./entry-icon-pierre")

const ICON_COLORS: Record<string, readonly [light: string, dark: string]> = {
  astro: ["#a631be", "#d568ea"],
  babel: ["#d5a910", "#ffd452"],
  bash: ["#199f43", "#5ecc71"],
  biome: ["#1a85d4", "#69b1ff"],
  bootstrap: ["#693acf", "#9d6afb"],
  browserslist: ["#d5a910", "#ffd452"],
  bun: ["#594c5b", "#79697b"],
  c: ["#1a85d4", "#69b1ff"],
  claude: ["#d47628", "#ffa359"],
  cpp: ["#1a85d4", "#69b1ff"],
  css: ["#693acf", "#9d6afb"],
  database: ["#a631be", "#d568ea"],
  default: ["#84848a", "#adadb1"],
  docker: ["#1a85d4", "#69b1ff"],
  eslint: ["#693acf", "#9d6afb"],
  git: ["#ff8c5b", "#d5512f"],
  go: ["#1ca1c7", "#68cdf2"],
  graphql: ["#d32a61", "#ff678d"],
  html: ["#d47628", "#ffa359"],
  image: ["#d32a61", "#ff678d"],
  javascript: ["#d5a910", "#ffd452"],
  json: ["#d47628", "#ffa359"],
  markdown: ["#199f43", "#5ecc71"],
  mcp: ["#17a5af", "#64d1db"],
  nextjs: ["#84848a", "#adadb1"],
  npm: ["#d52c36", "#ff6762"],
  oxc: ["#1ca1c7", "#68cdf2"],
  postcss: ["#d52c36", "#ff6762"],
  prettier: ["#17a5af", "#64d1db"],
  python: ["#1a85d4", "#69b1ff"],
  react: ["#1ca1c7", "#68cdf2"],
  ruby: ["#d52c36", "#ff6762"],
  rust: ["#d47628", "#ffa359"],
  sass: ["#d32a61", "#ff678d"],
  stylelint: ["#84848a", "#adadb1"],
  svelte: ["#d52c36", "#ff6762"],
  svg: ["#d47628", "#ffa359"],
  svgo: ["#199f43", "#5ecc71"],
  swift: ["#d47628", "#ffa359"],
  table: ["#17a5af", "#64d1db"],
  tailwind: ["#1ca1c7", "#68cdf2"],
  terraform: ["#693acf", "#9d6afb"],
  text: ["#84848a", "#adadb1"],
  typescript: ["#1a85d4", "#69b1ff"],
  vite: ["#a631be", "#d568ea"],
  vscode: ["#1a85d4", "#69b1ff"],
  vue: ["#199f43", "#5ecc71"],
  wasm: ["#693acf", "#9d6afb"],
  webpack: ["#1a85d4", "#69b1ff"],
  yml: ["#d52c36", "#ff6762"],
  zig: ["#d47628", "#ffa359"],
  zip: ["#d47628", "#ffa359"],
}

/** A plain document outline in the icon's box. It stands in until Pierre's set loads. */
const NEUTRAL_GLYPH =
  '<path d="M4.5 1.75h4.6l3.15 3.15v9.35h-7.75z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>'

const SPRITE_ID = "kiko-pierre-file-icon-sprite"

let pierre: Pierre | undefined
const [loaded, setLoaded] = createSignal(false)
let loading: Promise<void> | undefined

/** Loads Pierre's icon set once and puts its sprite in the page. Safe to call on every render. */
export function loadEntryIcons(): Promise<void> {
  loading ??= import("./entry-icon-pierre").then((mod) => {
    if (typeof document !== "undefined" && !document.getElementById(SPRITE_ID)) {
      const container = document.createElement("div")
      container.id = SPRITE_ID
      container.setAttribute("aria-hidden", "true")
      container.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none"
      container.innerHTML = mod.entrySpriteSheet()
      document.body.prepend(container)
    }
    pierre = mod
    setLoaded(true)
  })
  return loading
}

/**
 * The icon as markup, sized by the caller. Reading it in a Solid effect redraws it when the set
 * lands. Code outside Solid calls `loadEntryIcons().then(...)` and sets the markup again.
 */
export function entryIconMarkup(path: string): string {
  void loadEntryIcons()
  if (!loaded() || !pierre) {
    return `<svg aria-hidden="true" viewBox="0 0 16 16" data-component="entry-icon" data-icon-token="pending" class="entry-icon" style="--entry-icon-light:${ICON_COLORS.default![0]};--entry-icon-dark:${ICON_COLORS.default![1]}">${NEUTRAL_GLYPH}</svg>`
  }
  const icon = pierre.resolveEntryIcon(path)
  const colors = ICON_COLORS[icon.token] ?? ICON_COLORS.default!
  return `<svg aria-hidden="true" viewBox="0 0 16 16" data-component="entry-icon" data-pierre-icon="${icon.name}" data-icon-token="${icon.token}" class="entry-icon" style="--entry-icon-light:${colors[0]};--entry-icon-dark:${colors[1]}"><use href="#${icon.name}"/></svg>`
}
