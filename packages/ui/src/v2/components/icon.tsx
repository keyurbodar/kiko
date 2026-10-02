import { onMount, type ComponentProps, splitProps } from "solid-js"

/* Every icon's viewBox, so an icon renders its final markup before its glyph arrives. */
const icons = {
  edit: "0 0 16 16",
  "folder-add-left": "0 0 16 16",
  folder: "0 0 16 16",
  branch: "0 0 16 16",
  "grid-plus": "0 0 16 16",
  help: "0 0 16 16",
  "sidebar-right": "0 0 20 20",
  status: "0 0 20 20",
  "status-active": "0 0 20 20",
  "magnifying-glass": "0 0 16 16",
  menu: "0 0 16 16",
  plus: "0 0 16 16",
  "settings-gear": "0 0 16 16",
  "chevron-down": "0 0 16 16",
  collapse: "0 0 16 16",
  check: "0 0 16 16",
  monitor: "0 0 16 16",
  "workspace-new": "0 0 16 16",
  "workspace-isolated": "0 0 16 16",
  workspace: "0 0 16 16",
  close: "0 0 20 20",
  "xmark-small": "0 0 16 16",
  "outline-xmark": "0 0 16 16",
  "outline-chevron-down": "0 0 16 16",
  "outline-dots": "0 0 16 16",
  expand: "0 0 16 16",
  filetree: "0 0 16 16",
  split: "0 0 16 16",
  unified: "0 0 16 16",
  review: "0 0 20 20",
  "outline-sliders": "0 0 16 16",
  "outline-copy": "0 0 16 16",
  "outline-square-arrow": "0 0 16 16",
  "outline-share": "0 0 16 16",
  reset: "0 0 20 20",
  "outline-reset": "0 0 20 20",
  archive: "0 0 16 16",
}

export type IconName = keyof typeof icons

/* The glyphs shown at rest ship with the component. The rest are in icon-bodies.ts. */
const eager: Partial<Record<IconName, string>> = {
  plus: `<path d="M8 2.88867V13.1109" stroke="currentColor" stroke-linejoin="round"/><path d="M2.88867 8H13.1109" stroke="currentColor" stroke-linejoin="round"/>`,
  "chevron-down": `<path d="M5 6.5L8 9.5L11 6.5" stroke="currentColor"/>`,
  "xmark-small": `<path d="M4.25 11.75L11.75 4.25M11.75 11.75L4.25 4.25" stroke="currentColor"/>`,
}

const spriteID = "opencode-v2-icon-sprite"
const symbol = (name: IconName) => `opencode-v2-icon-${name}`
let spriteInserted = false

function ensureSprite() {
  if (spriteInserted) return
  if (typeof document === "undefined") return
  if (document.getElementById(spriteID)) {
    spriteInserted = true
    return
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.id = spriteID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  svg.innerHTML = symbols(eager)
  document.body.insertBefore(svg, document.body.firstChild)
  spriteInserted = true
  void import("./icon-bodies").then(({ bodies }) => svg.insertAdjacentHTML("beforeend", symbols(bodies)))
}

function symbols(bodies: Partial<Record<IconName, string>>) {
  return Object.entries(bodies)
    .map(([name, body]) => `<symbol id="${symbol(name as IconName)}" viewBox="${icons[name as IconName]}">${body}</symbol>`)
    .join("")
}

export interface IconProps extends ComponentProps<"svg"> {
  name: IconName | (string & {})
  size?: "small" | "normal" | "large"
}

export function Icon(props: IconProps) {
  const [split, rest] = splitProps(props, ["name", "size"])
  const iconName = () => (icons[split.name as IconName] ? (split.name as IconName) : "plus")
  const viewBox = () => icons[iconName()]
  const pixelSize = split.size === "small" ? 14 : split.size === "large" ? 20 : 16
  onMount(ensureSprite)

  return (
    <svg
      {...rest}
      data-slot="icon-svg"
      width={pixelSize}
      height={pixelSize}
      viewBox={viewBox()}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <use href={`#${symbol(iconName())}`} />
    </svg>
  )
}
