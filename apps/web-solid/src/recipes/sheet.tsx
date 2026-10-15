import type { RecipeCard } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { Dialog } from "../lib/dialog"
import { Button, muted } from "../settings/kit"
import { sheetLine } from "./model"
import { RecipeIcon } from "./recipe-icon"
import { addOwnChat, addToKiko, isAdded, isOwning, openRecipeFile } from "./state"

/*
 * A recipe's sheet: the icon, the title, what it does, when and with what, and one add. The
 * dialog's own header holds only the title, for screen readers, so the look is the icon first.
 */
export function RecipeSheet(props: { recipe: RecipeCard; onClose: () => void }) {
  const navigate = useNavigate()
  const go = (to: string) => navigate(to)
  return (
    <Dialog open onClose={props.onClose} title={<span class="sr-only">{props.recipe.title}</span>} data-component="recipe-sheet">
      <div class="flex flex-col items-center gap-3 pt-2 text-center">
        <RecipeIcon recipe={props.recipe} size={96} />
        <p class="text-lg font-semibold leading-snug text-foreground">{props.recipe.title}</p>
        <p class="text-md leading-relaxed text-muted-foreground">{props.recipe.description}</p>
        <p class={`text-sm ${muted}`}>{sheetLine(props.recipe)}</p>
        <Button variant="primary" class="mt-2 w-full" data-action="add-recipe" disabled={isAdded(props.recipe.slug)} onClick={() => addToKiko(props.recipe, go)}>
          {isAdded(props.recipe.slug) ? "Added" : "Add to Kiko"}
        </Button>
        <button
          type="button"
          class="cursor-pointer text-sm text-muted-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          data-action="recipe-own-chat"
          disabled={isOwning(props.recipe.slug)}
          onClick={() => addOwnChat(props.recipe, go)}
        >
          {isOwning(props.recipe.slug) ? "Making its chat" : "or give it its own chat"}
        </button>
        <button type="button" class="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline" data-action="recipe-file" onClick={() => openRecipeFile(props.recipe.slug, go)}>
          View or edit its file
        </button>
      </div>
    </Dialog>
  )
}
