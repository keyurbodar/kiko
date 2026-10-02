import { createSignal } from "solid-js"

/*
 * The files header's "new file" button and the file tree are in different modules, and the tree
 * loads lazily. The button bumps this counter and the tree opens its name field when it changes.
 */
const [tick, setTick] = createSignal(0)

export const newFileRequests = tick
export const requestNewFile = () => setTick((n) => n + 1)
