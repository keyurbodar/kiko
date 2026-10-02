import { useLocation } from "@solidjs/router"
import { SettingsShell } from "../../settings/settings-shell"
import { DeleteAccount } from "../delete-account"

export default function SettingsRoute() {
  const location = useLocation()
  const segment = () => location.pathname.split("/")[2]
  const sectionId = () => (segment() === "models" || segment() === "integrations" ? segment()! : "providers")
  return segment() === "account" ? <DeleteAccount /> : <SettingsShell sectionId={sectionId()} />
}
