import { createRoot, createSignal } from "solid-js"

/** Which agent's bird the picker is changing, or null when it is closed. Any surface can open it. */
const [pickingFor, setPickingFor] = createRoot(() => createSignal<string | null>(null))

export const birdPickerSlug = pickingFor
export const openBirdPicker = (slug: string) => setPickingFor(slug)
export const closeBirdPicker = () => setPickingFor(null)
