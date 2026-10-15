import { A, useSearchParams } from "@solidjs/router"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { BackIcon, SparklesIcon } from "@kiko/ui/icons"

export default function RecipesSidebar() {
  const [params] = useSearchParams()
  const href = (installed: boolean) => `/recipes?${new URLSearchParams({ ...(installed ? { view: "installed" } : {}), ...(typeof params.room === "string" ? { room: params.room } : {}) })}`
  return (
    <nav class="settings-panel" data-component="recipes-panel" aria-label="Recipes navigation">
      <A href="/chat" class="settings-panel-row"><HugeIcon icon={BackIcon} size={16} /><span class="settings-row-label">Chats</span></A>
      <div class="settings-group">
        <A href={href(false)} class="settings-panel-row" classList={{ "settings-panel-row-active": params.view !== "installed" }}><HugeIcon icon={SparklesIcon} size={16} /><span class="settings-row-label">All recipes</span></A>
        <A href={href(true)} class="settings-panel-row" classList={{ "settings-panel-row-active": params.view === "installed" }}><span class="settings-row-label pl-6">In use</span></A>
      </div>
    </nav>
  )
}
