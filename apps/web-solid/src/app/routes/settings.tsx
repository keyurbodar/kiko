import { Navigate, useLocation } from "@solidjs/router"
import { Show } from "solid-js"
import { SETTINGS_SECTIONS } from "../../settings/sections"
import { SettingsShell } from "../../settings/settings-shell"

const SECTION_IDS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS.map((s) => s.id))

/**
 * `/settings/<section>`. The section list is in the sidebar; bare `/settings` shows models.
 * Providers used to be their own section and are now part of models, so old links land there.
 */
export default function SettingsRoute() {
  const location = useLocation()
  const segment = () => location.pathname.split("/")[2] ?? ""
  const sectionId = () => (SECTION_IDS.has(segment()) ? segment() : "models")
  return (
    <Show when={segment() !== "providers"} fallback={<Navigate href="/settings/models" />}>
      <SettingsShell sectionId={sectionId()} />
    </Show>
  )
}
