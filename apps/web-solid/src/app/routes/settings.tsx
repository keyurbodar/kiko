import { useLocation } from "@solidjs/router"
import { SETTINGS_SECTIONS } from "../../settings/sections"
import { SettingsShell } from "../../settings/settings-shell"
import { DeleteAccount } from "../delete-account"

const SECTION_IDS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS.map((s) => s.id))

/** `/settings/<section>`. The section list is in the sidebar; bare `/settings` shows providers. */
export default function SettingsRoute() {
  const location = useLocation()
  const segment = () => location.pathname.split("/")[2] ?? ""
  const sectionId = () => (SECTION_IDS.has(segment()) ? segment() : "providers")
  return sectionId() === "account" ? <DeleteAccount /> : <SettingsShell sectionId={sectionId()} />
}
