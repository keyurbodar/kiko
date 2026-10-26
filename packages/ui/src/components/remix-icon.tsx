import { splitProps, type ComponentProps } from "solid-js"
import type { Glyph } from "../icons.gen"

export type { Glyph }

export type RemixIconProps = Omit<ComponentProps<"svg">, "children"> & {
  icon: Glyph
  size?: number
}

export function RemixIcon(props: RemixIconProps) {
  const [own, rest] = splitProps(props, ["icon", "size"])
  return (
    <svg
      data-component="remix-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={own.size ?? 16}
      height={own.size ?? 16}
      fill="none"
      {...rest}
      innerHTML={own.icon}
    />
  )
}
