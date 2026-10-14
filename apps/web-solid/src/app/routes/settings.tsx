import { useLocation } from "@solidjs/router"
import { SECTION_ALIAS, SETTINGS_SECTIONS } from "../../settings/sections"
import { SettingsShell } from "../../settings/settings-shell"

const SECTION_IDS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS.map((s) => s.id))

/**
 * `/settings/<section>/<tab>`. The section list is in the sidebar. Bare `/settings` shows models,
 * because connecting a provider is the first thing to do. A merged section's old URL still lands.
 */
export default function SettingsRoute() {
  const location = useLocation()
  const parts = () => location.pathname.split("/")
  const target = () => {
    const [, , section = "", tab] = parts()
    if (SECTION_IDS.has(section)) return { section, tab }
    return SECTION_ALIAS[section] ?? { section: "models" }
  }
  return <SettingsShell sectionId={target().section} tab={target().tab} />
}
