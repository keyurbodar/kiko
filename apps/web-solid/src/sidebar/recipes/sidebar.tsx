import { A, useSearchParams } from "@solidjs/router"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { BackIcon, SparklesIcon } from "@kiko/ui/icons"

export default function RecipesSidebar() {
  const [params] = useSearchParams()
  const href = () => (typeof params.room === "string" ? `/recipes?room=${encodeURIComponent(params.room)}` : "/recipes")
  return (
    <nav class="settings-panel" data-component="recipes-panel" aria-label="Recipes navigation">
      <A href="/chat" class="settings-panel-row"><HugeIcon icon={BackIcon} size={16} /><span class="settings-row-label">Chats</span></A>
      <div class="settings-group">
        <A href={href()} class="settings-panel-row settings-panel-row-active"><HugeIcon icon={SparklesIcon} size={16} /><span class="settings-row-label">Recipes</span></A>
      </div>
    </nav>
  )
}
