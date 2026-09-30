import type { JSX } from "solid-js"

/**
 * `<emoji-picker>` from `emoji-picker-element`, for Solid's JSX.
 *
 * The element is a web component, so this only teaches the compiler that the
 * tag exists and may carry attributes; the runtime shape is the package's.
 */
declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "emoji-picker": JSX.HTMLAttributes<HTMLElement> & {
        "data-source"?: string
        locale?: string
        "skin-tone-emoji"?: string
        "emoji-version"?: string
        hidden?: boolean
      }
    }
  }
}

export {}
