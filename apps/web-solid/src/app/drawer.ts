import { createSignal } from "solid-js"

/*
 * The mobile sidebar drawer. The shell owns the narrow-screen rules; this is the one open flag, so a
 * route with nothing to show yet (an empty file view) can offer a button that opens the list.
 */
export const [drawerOpen, setDrawerOpen] = createSignal(false)
