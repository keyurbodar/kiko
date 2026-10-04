import { splitProps, type ComponentProps } from "solid-js"
import { HugeIcon, type IconKey } from "./huge-icon"

/* The older icon names still in use, each drawn by one of kiko's icons. */
const NAMES = {
  "arrow-up": "arrow-up",
  stop: "stop",
  "arrow-undo-down": "reply",
  link: "link",
  "magnifying-glass": "search",
} as const satisfies Record<string, IconKey>

export type IconName = keyof typeof NAMES

export interface IconProps extends Omit<ComponentProps<"svg">, "children"> {
  name: IconName
  size?: "small" | "normal" | "medium" | "large"
}

/** Sized by `icon.css` through `data-size`, so the glyph fills the box it sits in. */
export function Icon(props: IconProps) {
  const [local, others] = splitProps(props, ["name", "size"])
  return (
    <div data-component="icon" data-size={local.size || "normal"}>
      <HugeIcon {...others} data-slot="icon-svg" name={NAMES[local.name]} />
    </div>
  )
}
