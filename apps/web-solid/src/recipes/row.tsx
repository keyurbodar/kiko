import type { RecipeCard, RecipeInstall } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { MoreIcon, PauseIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { useNavigate } from "@solidjs/router"
import { Show } from "solid-js"
import { cn } from "../lib/cn"
import { ChatAvatar, IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { iconButtonClass, Spinner } from "../settings/kit"
import { RecipeIcon, RecipeWatermark, toneStyle } from "./icon"
import { type InstallStatus, installStatus, nextRunLabel } from "./model"
import { agentName, editRecipe, isEditing, removeInstall, setInstallPaused, targetsForChat } from "./state"

const pillClass = "relative h-7 shrink-0 cursor-pointer rounded-full px-3 text-xs text-muted-foreground hover:bg-control-strong hover:text-foreground"

export function StatusChip(props: { status: InstallStatus }) {
  const chip = "flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs"
  return (
    <span class="flex min-w-0 items-center gap-2" data-component="recipe-status">
      {(() => {
        const s = props.status
        if (s.kind === "next") return <span class={cn(chip, "min-w-0 bg-control text-foreground/85")}><span class="truncate">{nextRunLabel(s.at, Date.now())}</span></span>
        if (s.kind === "paused")
          return (
            <>
              <span class={cn(chip, "bg-control text-muted-foreground")}>
                <RemixIcon icon={PauseIcon} size={11} />
                Paused
              </span>
              <span class="truncate text-xs text-muted-foreground">{s.schedule}</span>
            </>
          )
        return <span class="truncate text-xs text-muted-foreground">{s.label}</span>
      })()}
    </span>
  )
}

function InstallActions(props: { install: RecipeInstall; card: RecipeCard; go: (to: string) => void }) {
  const status = () => installStatus(props.install, props.card)
  return (
    <span class="relative flex shrink-0 items-center gap-0.5">
      <Show when={status().kind !== "ask"}>
        <button type="button" class={pillClass} data-action="recipe-pause" onClick={() => setInstallPaused(props.install, status().kind === "next")}>
          {status().kind === "next" ? "Pause" : "Resume"}
        </button>
      </Show>
      <MenuV2 gutter={4} placement="bottom-end">
        <MenuV2.Trigger class={cn(iconButtonClass, "rounded-full")} aria-label={`More for ${props.card.title}`}>
          <Show when={isEditing(props.card.slug)} fallback={<RemixIcon icon={MoreIcon} size={16} />}>
            <Spinner size={16} />
          </Show>
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="z-[80]">
            <MenuV2.Item onSelect={() => props.go(`/chat/${props.install.roomId}`)}>Open chat</MenuV2.Item>
            <MenuV2.Item onSelect={() => void editRecipe(props.card.slug, props.go)}>Edit recipe</MenuV2.Item>
            <MenuV2.Item onSelect={() => removeInstall(props.install)}>Remove from {agentName(props.install.agent)}</MenuV2.Item>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </span>
  )
}

function Runner(props: { install: RecipeInstall }) {
  return (
    <Show when={targetsForChat(props.install.roomId).length > 1}>
      <span class="flex shrink-0 items-center gap-1 text-xs text-foreground/80">
        <IdentityAvatar seed={props.install.agent} size={16} />
        {agentName(props.install.agent)}
      </span>
    </Show>
  )
}

export function InstallCard(props: { install: RecipeInstall; card: RecipeCard }) {
  const navigate = useNavigate()
  const chatName = () => useApp.chatById(props.install.roomId)?.name ?? agentName(props.install.agent)
  return (
    <article
      class="recipe-card flex min-w-0 flex-col gap-4 rounded-[20px] p-4 [--recipe-surface:var(--card)]"
      style={toneStyle(props.card)}
      data-install={props.install.installId}
      data-status={installStatus(props.install, props.card).kind}
    >
      <RecipeWatermark recipe={props.card} />
      <button
        type="button"
        class="flex min-w-0 cursor-pointer items-center gap-3.5 text-left outline-none after:absolute after:inset-0 after:rounded-[inherit]"
        data-action="open-recipe-chat"
        aria-label={`Open ${chatName()}`}
        onClick={() => navigate(`/chat/${props.install.roomId}`)}
      >
        <RecipeIcon recipe={props.card} size={48} stickers />
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">{props.card.title}</span>
          <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <ChatAvatar faces={useApp.chatFaces(props.install.roomId)} size={16} />
            <span class="truncate">{chatName()}</span>
          </span>
        </span>
      </button>
      <div class="flex min-w-0 items-center gap-2">
        <Runner install={props.install} />
        <span class="min-w-0 flex-1">
          <StatusChip status={installStatus(props.install, props.card)} />
        </span>
        <InstallActions install={props.install} card={props.card} go={navigate} />
      </div>
    </article>
  )
}

export function InstallRow(props: { install: RecipeInstall; card: RecipeCard; navigate: (to: string) => void }) {
  const title = () => useApp.chatById(props.install.roomId)?.name ?? agentName(props.install.agent)
  return (
    <div class="flex items-center gap-2 rounded-[14px] px-2.5 py-2 hover:bg-control" data-install={props.install.installId} data-status={installStatus(props.install, props.card).kind}>
      <button type="button" class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none" data-action="open-recipe-chat" onClick={() => props.navigate(`/chat/${props.install.roomId}`)}>
        <ChatAvatar faces={useApp.chatFaces(props.install.roomId)} size={36} />
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="truncate text-[13.5px] font-medium text-foreground">{title()}</span>
          <span class="flex min-w-0 items-center gap-2">
            <Runner install={props.install} />
            <StatusChip status={installStatus(props.install, props.card)} />
          </span>
        </span>
      </button>
      <InstallActions install={props.install} card={props.card} go={props.navigate} />
    </div>
  )
}
