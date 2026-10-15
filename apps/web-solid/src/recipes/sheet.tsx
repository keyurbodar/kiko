import type { RecipeCard } from "@kiko/protocol"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { useNavigate } from "@solidjs/router"
import { createSignal, For, Show } from "solid-js"
import { useApp } from "../lib/store"
import { Dialog } from "../lib/dialog"
import { Button, buttonClass, iconButtonClass } from "../settings/kit"
import { RecipeIcon } from "./recipe-icon"
import { addOwnChat, addToTarget, isAdded, isOwning, openRecipeFile, installsFor, removeInstall, targetFor, agentName, type RecipeTarget } from "./state"

export function RecipeSheet(props: { recipe: RecipeCard; onClose: () => void; roomId?: string | null }) {
  const navigate = useNavigate()
  const go = (to: string) => { props.onClose(); navigate(to) }
  const [choosing, setChoosing] = createSignal(false)
  const [chosen, setChosen] = createSignal<string>()
  const installs = () => installsFor(props.recipe.slug)
  const available = () => props.roomId ? useApp.roomMembers().filter((m) => !isAdded(props.recipe.slug, { roomId: props.roomId as RecipeTarget["roomId"], agent: m.slug, name: m.name })) : []
  const target = (): RecipeTarget | undefined => {
    const base = targetFor(props.roomId)
    const member = available().find((m) => m.slug === chosen()) ?? available().find((m) => m.lead) ?? available()[0]
    return base && member ? { ...base, agent: member.slug, name: member.name } : base
  }
  const canAdd = () => !isAdded(props.recipe.slug, target())
  return (
    <Dialog open onClose={props.onClose} title={props.recipe.title} data-component="recipe-sheet">
      <div class="flex flex-col gap-5">
        <div class="flex items-start gap-3">
          <RecipeIcon recipe={props.recipe} size={48} />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <p class="text-sm leading-relaxed text-muted-foreground">{props.recipe.description}</p>
            <Show when={!installs().length}>
              <p class="text-xs text-muted-foreground">{props.recipe.when}</p>
            </Show>
          </div>
        </div>
        <Show when={props.recipe.apps.length}>
          <ul class="flex flex-wrap gap-1.5" aria-label="Apps used by this recipe">
            <For each={props.recipe.apps}>{(app) => <li class="rounded-md bg-control px-2 py-1 text-xs text-muted-foreground">{app}</li>}</For>
          </ul>
        </Show>

        <Show when={installs().length}>
          <div class="flex flex-col gap-2" data-component="recipe-installs">
            <p class="text-xs font-medium text-muted-foreground">Using this recipe</p>
            <For each={installs()}>{(install) => {
              const name = () => agentName(install.agent)
              const chat = () => useApp.chatById(install.roomId)?.name
              return (
                <div class="flex items-center gap-2 rounded-lg bg-control px-3 py-2" data-install={install.installId}>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-sm font-medium text-foreground">{name()}</span>
                    <Show when={chat() && chat() !== name()}><span class="truncate text-xs text-muted-foreground">{chat()}</span></Show>
                  </div>
                  <Button variant={installs().length === 1 ? "primary" : "secondary"} data-action="open-recipe-chat" onClick={() => go(`/chat/${install.roomId}`)}>Open chat</Button>
                  <MenuV2 gutter={4} placement="bottom-end">
                    <MenuV2.Trigger class={iconButtonClass} aria-label={`Options for ${name()}`}><span aria-hidden="true">⋯</span></MenuV2.Trigger>
                    <MenuV2.Portal>
                      <MenuV2.Content class="recipe-menu">
                        <MenuV2.Item onSelect={() => removeInstall(install)}>Remove from {name()}</MenuV2.Item>
                      </MenuV2.Content>
                    </MenuV2.Portal>
                  </MenuV2>
                </div>
              )
            }}</For>
          </div>
        </Show>

        <Show when={canAdd() && (!installs().length || choosing())}>
          <div class="flex flex-col gap-2">
            <Show when={props.roomId && available().length > 1}>
              <label class="flex items-center justify-between text-sm text-muted-foreground">
                Use with
                <select aria-label="Recipe agent" class="rounded-md bg-control px-2 py-1 text-foreground" value={target()?.agent} onChange={(e) => setChosen(e.currentTarget.value)}>
                  <For each={available()}>{(m) => <option value={m.slug}>{m.name}</option>}</For>
                </select>
              </label>
            </Show>
            <Button variant="primary" class="w-full" data-action="add-recipe" onClick={() => addToTarget(props.recipe, target(), go)}>Use with {target()?.name ?? "Kiko"}</Button>
          </div>
        </Show>

        <div class="flex items-center justify-between gap-2">
          <Show when={installs().length && canAdd() && !choosing()} fallback={<span />}>
            <button type="button" class="cursor-pointer text-sm text-muted-foreground hover:text-foreground" onClick={() => setChoosing(true)}>Use with {target()?.name ?? "another agent"}</button>
          </Show>
          <MenuV2 gutter={4} placement="bottom-end">
            <MenuV2.Trigger class={buttonClass("ghost")} aria-label="More recipe options" disabled={isOwning(props.recipe.slug)}>{isOwning(props.recipe.slug) ? "Creating chat…" : "More"} <span aria-hidden="true">⋯</span></MenuV2.Trigger>
            <MenuV2.Portal>
              <MenuV2.Content class="recipe-menu">
                <MenuV2.Item disabled={isOwning(props.recipe.slug)} data-action="recipe-own-chat" onSelect={() => addOwnChat(props.recipe, go)}>{isOwning(props.recipe.slug) ? "Creating chat…" : "Create a dedicated chat"}</MenuV2.Item>
                <MenuV2.Item data-action="recipe-file" onSelect={() => openRecipeFile(props.recipe.slug, go)}>Edit recipe</MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </div>
    </Dialog>
  )
}
