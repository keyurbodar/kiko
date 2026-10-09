import { splitProps, type ComponentProps } from "solid-js"
import { HugeIcon } from "./huge-icon"
import { ArrowUpIcon, type Glyph, LinkIcon, ReplyIcon, SearchIcon, StopIcon } from "../icons.gen"

/* The older icon names still in use, each drawn by one of yuki's icons. */
const NAMES = {
  "arrow-up": ArrowUpIcon,
  stop: StopIcon,
  "arrow-undo-down": ReplyIcon,
  link: LinkIcon,
  "magnifying-glass": SearchIcon,
} as const satisfies Record<string, Glyph>

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
      <HugeIcon {...others} data-slot="icon-svg" icon={NAMES[local.name]} />
    </div>
  )
}
