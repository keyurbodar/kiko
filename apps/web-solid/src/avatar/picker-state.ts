import { createRoot, createSignal } from "solid-js"

const [pickingFor, setPickingFor] = createRoot(() => createSignal<string | null>(null))

export const avatarPickerSlug = pickingFor
export const openAvatarPicker = (slug: string) => setPickingFor(slug)
export const closeAvatarPicker = () => setPickingFor(null)
