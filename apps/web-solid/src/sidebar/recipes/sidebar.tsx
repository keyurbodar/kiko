import { Link, useSearch } from "@tanstack/solid-router"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { BackIcon, SparklesIcon } from "@kiko/ui/icons"

export default function RecipesSidebar() {
  const room = useSearch({ strict: false, select: (search) => search.room })
  return (
    <nav class="settings-panel" data-component="recipes-panel" aria-label="Recipes navigation">
      <Link to="/chat" class="settings-panel-row">
        <RemixIcon icon={BackIcon} size={16} />
        <span class="settings-row-label">Chats</span>
      </Link>
      <div class="settings-group">
        <Link
          to="/recipes"
          search={room() ? { room: room() } : {}}
          class="settings-panel-row settings-panel-row-active"
        >
          <RemixIcon icon={SparklesIcon} size={16} />
          <span class="settings-row-label">Recipes</span>
        </Link>
      </div>
    </nav>
  )
}
