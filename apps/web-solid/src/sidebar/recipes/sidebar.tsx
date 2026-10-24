import { Link, useSearch } from "@tanstack/solid-router"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChatIcon, LeafIcon } from "@kiko/ui/icons"

export default function RecipesSidebar() {
  const room = useSearch({ strict: false, select: (search) => search.room })
  return (
    <nav class="settings-panel" data-component="recipes-panel" aria-label="Recipes navigation">
      <div class="settings-group">
        <div class="settings-label">Recipes</div>
        <Link
          to="/recipes"
          search={room() ? { room: room() } : {}}
          class="settings-panel-row settings-panel-row-active"
        >
          <RemixIcon icon={LeafIcon} size={16} />
          <span class="settings-row-label">All recipes</span>
        </Link>
        <Link to="/chat" class="settings-panel-row">
          <RemixIcon icon={ChatIcon} size={16} />
          <span class="settings-row-label">Back to chats</span>
        </Link>
      </div>
    </nav>
  )
}
