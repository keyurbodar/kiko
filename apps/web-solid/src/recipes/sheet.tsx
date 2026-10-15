import type { RecipeCard } from "@kiko/protocol"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { useNavigate } from "@solidjs/router"
import { createSignal, For, onMount, Show } from "solid-js"
import { AgentChip } from "../chat/ui/agent-chip"
import { triggerLabel } from "../chat/info/routines-model"
import { useApp } from "../lib/store"
import { Dialog } from "../lib/dialog"
import { Button, buttonClass, iconButtonClass } from "../settings/kit"
import { RecipeApps } from "./apps"
import { RecipeIcon } from "./recipe-icon"
import { RecipePicker } from "./picker"
import { openRecipeFile, installsFor, removeInstall, agentName, refreshListing, setRecipeRoutineStatus } from "./state"

export function RecipeSheet(props: { recipe: RecipeCard; onClose: () => void; roomId?: string | null; mode?: "add" | "details"; agent?: string }) {
  const navigate = useNavigate()
  const go = (to: string) => { props.onClose(); navigate(to) }
  const [adding, setAdding] = createSignal(props.mode === "add")
  const installs = () => installsFor(props.recipe.slug).filter((i) => !props.agent || i.agent === props.agent)
  onMount(() => void refreshListing())
  return (
    <Dialog open onClose={props.onClose} title={adding() ? `Add ${props.recipe.title}` : props.recipe.title} data-component="recipe-sheet">
      <div class="flex flex-col gap-5">
        <Show when={!adding()} fallback={<RecipePicker recipe={props.recipe} roomId={props.roomId} navigate={go} />}>
          <div class="flex items-start gap-3">
            <RecipeIcon recipe={props.recipe} size={48} />
            <p class="min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground">{props.recipe.description}</p>
          </div>
          <RecipeApps apps={props.recipe.apps} />
          <Show when={installs().length} fallback={<p class="text-sm text-muted-foreground">{props.recipe.when}</p>}>
            <div class="flex flex-col gap-3" data-component="recipe-installs">
              <For each={installs()}>{(install) => (
                <section class="flex flex-col gap-3 rounded-lg border border-border p-3" data-install={install.installId}>
                  <div class="flex items-center gap-2">
                    <div class="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                      <span class="text-sm"><AgentChip slug={install.agent} name={agentName(install.agent)} /></span>
                      <p class="max-w-full truncate text-xs text-muted-foreground">{useApp.chatById(install.roomId)?.name ?? "Chat"}</p>
                    </div>
                    <Button data-action="open-recipe-chat" onClick={() => go(`/chat/${install.roomId}`)}>Open chat</Button>
                    <MenuV2 gutter={4} placement="bottom-end">
                      <MenuV2.Trigger class={iconButtonClass} aria-label={`Options for ${agentName(install.agent)}`}><span aria-hidden="true">⋯</span></MenuV2.Trigger>
                      <MenuV2.Portal><MenuV2.Content class="recipe-menu"><MenuV2.Item onSelect={() => removeInstall(install)}>Remove from {agentName(install.agent)}</MenuV2.Item></MenuV2.Content></MenuV2.Portal>
                    </MenuV2>
                  </div>
                  <Show when={install.routines} fallback={<p class="text-xs text-muted-foreground">Routine details will appear when synced.</p>}>
                    {(routines) => <Show when={routines().length} fallback={<p class="text-xs text-muted-foreground">No routines for this install.</p>}>
                      <For each={routines()}>{(routine) => <div class="flex items-center gap-3 border-t border-border pt-3" data-recipe-routine={routine.id} data-status={routine.status}>
                        <div class="flex min-w-0 flex-1 flex-col gap-1">
                          <span class="text-sm text-foreground">{triggerLabel(routine.trigger, routine.tz)}</span>
                          <span class="text-xs text-muted-foreground">{routine.status === "paused" ? "Paused" : "Active"}</span>
                        </div>
                        <Button data-action="recipe-routine-toggle" onClick={() => setRecipeRoutineStatus(routine, routine.status === "active" ? "paused" : "active")}>{routine.status === "active" ? "Pause" : "Resume"}</Button>
                      </div>}</For>
                    </Show>}
                  </Show>
                </section>
              )}</For>
            </div>
          </Show>
          <div class="flex items-center justify-between gap-3">
            <button type="button" class={buttonClass("ghost")} data-action="recipe-file" onClick={() => openRecipeFile(props.recipe.slug, go)}>Edit recipe</button>
            <Button data-action="add-recipe" onClick={() => setAdding(true)}>Add</Button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
