import { useLocation } from "@solidjs/router"
import { SettingsShell } from "../../settings/settings-shell"

export default function SettingsRoute() {
  const location = useLocation()
  const sectionId = () => {
    const id = location.pathname.split("/")[2]
    return id === "models" || id === "appearance" ? id : "providers"
  }
  return <SettingsShell sectionId={sectionId()} />
}
