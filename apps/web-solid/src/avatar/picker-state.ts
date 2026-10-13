import { createRoot, createSignal } from "solid-js"

/** Which agent's avatar the picker is changing, or null when it is closed. Any surface can open it. */
const [pickingFor, setPickingFor] = createRoot(() => createSignal<string | null>(null))

export const avatarPickerSlug = pickingFor
export const openAvatarPicker = (slug: string) => setPickingFor(slug)
export const closeAvatarPicker = () => setPickingFor(null)
