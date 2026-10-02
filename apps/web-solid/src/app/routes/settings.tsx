import { useLocation } from "@solidjs/router"
import { SettingsShell } from "../../settings/settings-shell"

const SECTION_IDS = new Set(["providers", "models", "integrations", "appearance", "account"])

export default function SettingsRoute() {
  const location = useLocation()
  const segment = () => location.pathname.split("/")[2] ?? ""
  const sectionId = () => (SECTION_IDS.has(segment()) ? segment() : "providers")
  return <SettingsShell sectionId={sectionId()} />
}
