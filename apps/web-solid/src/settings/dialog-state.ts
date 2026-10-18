import { createRoot, createSignal } from "solid-js"
import type { SettingsSection } from "./sections"

/*
 * Which section the settings dialog shows, or null while it is closed. Kept apart from the dialog so
 * the sidebar, the commands and the error toasts can open it without importing it: the dialog and every
 * section's page are one chunk, and the first paint carries only this file. The shell holds the dialog's
 * lazy loader, as it does for the other dialogs. A dynamic import here would put the chunk's list of
 * files to preload into the chunk this file shares with the chat route, about half a kilobyte.
 */
const [section, setSection] = createRoot(() => createSignal<SettingsSection["id"] | null>(null))

export const settingsSection = section
/** Opens the dialog on a section, or moves an open one there. Models by default, because connecting a provider comes first. */
export const openSettings = (id: SettingsSection["id"] = "models") => setSection(id)
export const closeSettings = () => setSection(null)
