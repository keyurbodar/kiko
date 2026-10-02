import { onMount, splitProps, type ComponentProps } from "solid-js"
import type { IconName } from "./icon-paths"

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
  void import("./icon-paths").then(({ icons }) => insertSprite(body, icons))
}

function insertSprite(body: HTMLElement, icons: Record<IconName, string>) {
  if (document.getElementById(spriteID)) return
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.id = spriteID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  svg.innerHTML = Object.entries(icons)
    .map(([name, path]) => {
      const key = name as IconName
      return `<symbol id="${symbol(key)}" viewBox="${viewBox(key)}">${path}</symbol>`
    })
    .join("")
  body.insertBefore(svg, body.firstChild)
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
