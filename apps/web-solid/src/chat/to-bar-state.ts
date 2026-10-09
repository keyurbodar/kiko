import { createSignal } from "solid-js"

/*
 * A temporary chat whose "to:" search should open as soon as its bar mounts: "new group" starts a
 * chat with yuki and goes straight to picking who else is in it. Kept apart from the bar so the
 * sidebar can set it without loading the bar's code.
 */
const [pickFor, setPickFor] = createSignal<string | null>(null)
export { pickFor, setPickFor }
