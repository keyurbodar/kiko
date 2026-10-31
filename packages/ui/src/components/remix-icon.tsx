import { createEffect, splitProps, type ComponentProps } from "solid-js"
import type { Glyph } from "../icons.gen"
import { glyphNodes } from "./glyph-cache"

export type { Glyph }

export type IconSize = 12 | 13 | 14 | 16 | 18 | 20 | 24

export type RemixIconProps = Omit<ComponentProps<"svg">, "children"> & {
  icon: Glyph
  size?: IconSize
}

const server = typeof document === "undefined"

export function RemixIcon(props: RemixIconProps) {
  const [own, rest] = splitProps(props, ["icon", "size"])
  if (server) {
    return (
      <svg
        data-component="remix-icon"
        aria-hidden="true"
        viewBox="0 0 300 300"
        width={own.size ?? 16}
        height={own.size ?? 16}
        fill="currentColor"
        {...rest}
        innerHTML={own.icon}
      />
    )
  }
  let element!: SVGSVGElement
  createEffect(() => element.replaceChildren(...glyphNodes(own.icon)))
  return (
    <svg
      ref={element}
      data-component="remix-icon"
      aria-hidden="true"
      viewBox="0 0 300 300"
      width={own.size ?? 16}
      height={own.size ?? 16}
      fill="currentColor"
      {...rest}
    />
  )
}
