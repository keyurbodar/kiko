import { onMount, splitProps, type ComponentProps } from "solid-js"
import type { LazyIconName } from "./icon-paths"

/* The send and stop glyphs show at rest in the composer, so they ship with the component. */
const eager = {
  "arrow-up": `<path fill-rule="evenodd" clip-rule="evenodd" d="M9.99991 2.24121L16.0921 8.33343L15.2083 9.21731L10.6249 4.63397V17.5001H9.37492V4.63398L4.7916 9.21731L3.90771 8.33343L9.99991 2.24121Z" fill="currentColor"/>`,
  stop: `<rect x="5" y="5" width="10" height="10" fill="currentColor"/>`,
  "arrow-undo-down": `<path d="M4.08333 11.0859L1.75 8.7526L4.08333 6.41927M2.33333 8.7526L12.5417 8.7526L12.5417 3.21094L7 3.21094" stroke="currentColor" stroke-width="1" stroke-linecap="square"/>`,
}

export type IconName = keyof typeof eager | LazyIconName

const spriteID = "opencode-icon-sprite"
const symbol = (name: IconName) => `opencode-icon-${name}`
let spriteInserted = false

function viewBox(name: IconName) {
  return name === "magnifying-glass" || name === "arrow-undo-down" || name === "subagent" ? "0 0 16 16" : "0 0 20 20"
}

/* Inserts the sprite. Every icon calls it on mount; main.tsx also calls it on idle. */
export function ensureSprite() {
  if (spriteInserted) return
  if (typeof document === "undefined") return
  if (document.getElementById(spriteID)) {
    spriteInserted = true
    return
  }
  const body = document.body as HTMLElement | null
  if (!body) return
  spriteInserted = true
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.id = spriteID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  svg.innerHTML = symbols(eager)
  body.insertBefore(svg, body.firstChild)
  void import("./icon-paths").then(({ icons }) => svg.insertAdjacentHTML("beforeend", symbols(icons)))
}

function symbols(icons: Partial<Record<IconName, string>>) {
  return Object.entries(icons)
    .map(([name, path]) => {
      const key = name as IconName
      return `<symbol id="${symbol(key)}" viewBox="${viewBox(key)}">${path}</symbol>`
    })
    .join("")
}

export interface IconProps extends ComponentProps<"svg"> {
  name: IconName
  size?: "small" | "normal" | "medium" | "large"
}

export function Icon(props: IconProps) {
  const [local, others] = splitProps(props, ["name", "size", "class", "classList"])
  onMount(ensureSprite)

  return (
    <div
      data-component="icon"
      data-size={local.size || "normal"}
      data-directional={
        local.name === "arrow-left" ||
        local.name === "arrow-right" ||
        local.name === "chevron-left" ||
        local.name === "chevron-right"
          ? true
          : undefined
      }
    >
      <svg
        data-slot="icon-svg"
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
        fill="none"
        viewBox={viewBox(local.name)}
        aria-hidden="true"
        {...others}
      >
        <use href={`#${symbol(local.name)}`} />
      </svg>
    </div>
  )
}
