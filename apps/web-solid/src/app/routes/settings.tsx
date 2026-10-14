import { useLocation } from "@solidjs/router"
import { SECTION_ALIAS, SETTINGS_SECTIONS } from "../../settings/sections"
import { SettingsShell } from "../../settings/settings-shell"

const SECTION_IDS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS.map((s) => s.id))

/**
 * `/settings/<section>`. The section list is in the sidebar. Bare `/settings` shows models,
 * because connecting a provider is the first thing to do. A merged section's old URL still lands.
 */
export default function SettingsRoute() {
  const location = useLocation()
  const section = () => location.pathname.split("/")[2] ?? ""
  return <SettingsShell sectionId={SECTION_IDS.has(section()) ? section() : (SECTION_ALIAS[section()] ?? "models")} />
}
