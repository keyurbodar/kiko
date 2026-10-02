import { DeleteAccount } from "../delete-account"
import { Placeholder } from "./placeholder"

export default function SettingsRoute() {
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Placeholder name="settings" />
      <DeleteAccount />
    </div>
  )
}
