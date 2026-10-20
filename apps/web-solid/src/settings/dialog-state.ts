import { createRoot, createSignal } from "solid-js"
import type { SettingsSection } from "./sections"

const [section, setSection] = createRoot(() => createSignal<SettingsSection["id"] | null>(null))

export const settingsSection = section
export const openSettings = (id: SettingsSection["id"] = "models") => setSection(id)
export const closeSettings = () => setSection(null)
