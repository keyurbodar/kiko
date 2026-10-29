import { splitProps, type ComponentProps } from "solid-js"
import type { Glyph } from "../icons.gen"

export type { Glyph }

export type IconSize = 12 | 16 | 18 | 20 | 24

const STEP = {
  12: "xs",
  16: "sm",
  18: "nav",
  20: "md",
  24: "lg",
} as const satisfies Record<IconSize, string>

export type RemixIconProps = Omit<ComponentProps<"svg">, "children"> & {
  icon: Glyph
  size?: IconSize
}

export function RemixIcon(props: RemixIconProps) {
  const [own, rest] = splitProps(props, ["icon", "size"])
  const box = () => (own.size === undefined ? undefined : `var(--size-icon-${STEP[own.size]}, ${own.size}px)`)
  return (
    <svg
      data-component="remix-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={own.size ?? 16}
      height={own.size ?? 16}
      style={box() === undefined ? undefined : { width: box(), height: box() }}
      fill="none"
      {...rest}
      innerHTML={own.icon}
    />
  )
}
