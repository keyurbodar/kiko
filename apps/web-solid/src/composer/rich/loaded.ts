import { createSignal } from "solid-js"

/** True once the composer's rich editor chunk has loaded. The shell waits for it before it warms other routes. */
export const [richLoaded, setRichLoaded] = createSignal(false)
