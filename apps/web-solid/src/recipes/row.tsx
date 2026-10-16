import type { RecipeCard, RecipeInstall } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { MoreIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { useNavigate } from "@solidjs/router"
import { Show } from "solid-js"
import { cn } from "../lib/cn"
import { ChatAvatar, IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { iconButtonClass, Spinner } from "../settings/kit"
import { RecipeIcon } from "./icon"
import { installStatus, nextLabel } from "./model"
import { agentName, editRecipe, isEditing, removeInstall, setInstallPaused, targetsForChat } from "./state"

export const pillClass = "h-7 shrink-0 cursor-pointer rounded-full px-3 text-xs text-muted-foreground hover:bg-control-strong hover:text-foreground"

/** A filled dot for a recipe that will run, a ring for one that is paused. */
export function StatusDot(props: { paused?: boolean }) {
  return (
    <span
      class={cn(
        "size-[7px] shrink-0 rounded-full",
        props.paused ? "shadow-[inset_0_0_0_1.5px_currentColor]" : "bg-[var(--success)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_18%,transparent)]",
      )}
      aria-hidden="true"
    />
  )
}

/**
 * One recipe at work for one agent in one chat. `lead` is what the row is about: the recipe, where
 * rows are grouped by chat, or the chat, where rows sit under one recipe.
 */
export function InstallRow(props: { install: RecipeInstall; card: RecipeCard; lead: "recipe" | "chat"; navigate?: (to: string) => void }) {
  const navigate = useNavigate()
  const go = (to: string) => (props.navigate ?? navigate)(to)
  const status = () => installStatus(props.install, props.card)
  const inGroup = () => targetsForChat(props.install.roomId).length > 1
  const who = () => agentName(props.install.agent)
  const title = () => (props.lead === "recipe" ? props.card.title : (useApp.chatById(props.install.roomId)?.name ?? who()))
  return (
    <div class="flex items-center gap-2 rounded-[14px] px-2.5 py-2 hover:bg-control" data-install={props.install.installId} data-status={status().kind}>
      <button type="button" class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none" data-action="open-recipe-chat" onClick={() => go(`/chat/${props.install.roomId}`)}>
        <Show when={props.lead === "recipe"} fallback={<ChatAvatar faces={useApp.chatFaces(props.install.roomId)} size={36} />}>
          <RecipeIcon recipe={props.card} size={40} stickers />
        </Show>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13.5px] font-medium text-foreground">{title()}</span>
          <span class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Show when={inGroup()}>
              <span class="flex shrink-0 items-center gap-1 pr-1 text-foreground/80">
                <IdentityAvatar seed={props.install.agent} size={16} />
                {who()}
              </span>
            </Show>
            {(() => {
              const s = status()
              if (s.kind === "next") return <><StatusDot /><span class="truncate">{nextLabel(s.at, Date.now())}</span></>
              if (s.kind === "paused") return <><StatusDot paused /><span class="shrink-0">Paused</span><span class="truncate pl-1 opacity-75">{s.schedule}</span></>
              return <span class="truncate">{s.label}</span>
            })()}
          </span>
        </span>
      </button>
      <Show when={status().kind !== "ask"}>
        <button type="button" class={pillClass} data-action="recipe-pause" onClick={() => setInstallPaused(props.install, status().kind === "next")}>
          {status().kind === "next" ? "Pause" : "Resume"}
        </button>
      </Show>
      <MenuV2 gutter={4} placement="bottom-end">
        <MenuV2.Trigger class={cn(iconButtonClass, "rounded-full")} aria-label={`More for ${props.card.title}`}>
          <Show when={isEditing(props.card.slug)} fallback={<HugeIcon icon={MoreIcon} size={16} />}>
            <Spinner size={16} />
          </Show>
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="z-[80]">
            <MenuV2.Item onSelect={() => go(`/chat/${props.install.roomId}`)}>Open chat</MenuV2.Item>
            <MenuV2.Item onSelect={() => void editRecipe(props.card.slug, go)}>Edit recipe</MenuV2.Item>
            <MenuV2.Item onSelect={() => removeInstall(props.install)}>Remove from {who()}</MenuV2.Item>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </div>
  )
}
