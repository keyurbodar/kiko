import { useLocation } from "@solidjs/router"
import { SettingsShell } from "../../settings/settings-shell"

export default function SettingsRoute() {
  const location = useLocation()
  const sectionId = () => (location.pathname.split("/")[2] === "models" ? "models" : "providers")
  return <SettingsShell sectionId={sectionId()} />
}
