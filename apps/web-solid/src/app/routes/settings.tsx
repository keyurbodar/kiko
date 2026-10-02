import { useLocation } from "@solidjs/router"
import { SettingsShell } from "../../settings/settings-shell"
import { DeleteAccount } from "../delete-account"

const SECTION_IDS = new Set(["providers", "models", "integrations", "appearance"])

export default function SettingsRoute() {
  const location = useLocation()
  const segment = () => location.pathname.split("/")[2] ?? ""
  const sectionId = () => (SECTION_IDS.has(segment()) ? segment() : "providers")
  return segment() === "account" ? <DeleteAccount /> : <SettingsShell sectionId={sectionId()} />
}
