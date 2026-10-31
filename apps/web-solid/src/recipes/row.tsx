import type { RecipeCard, RecipeInstall } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ClockIcon, MoreIcon, PauseIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { openChat } from "../app/history"
import { Show } from "solid-js"
import { cn } from "../lib/cn"
import { ChatAvatar, IdentityAvatar } from "../lib/IdentityAvatar"
import { room } from "../state/room"
import { iconButtonClass, Spinner } from "../settings/kit"
import { type InstallStatus, installStatus, localizeWhen, nextRunLabel } from "./model"
import {
  agentName,
  editRecipe,
  freshElapsed,
  isEditing,
  removeInstall,
  setInstallPaused,
  targetsForChat,
} from "./state"

const pillClass =
  "relative h-7 shrink-0 cursor-pointer rounded-full px-3 text-hint text-fg3 hover:bg-hover hover:text-fg"

function StatusChip(props: { status: InstallStatus }) {
  const chip = "flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-hint"
  return (
    <span class="flex min-w-0 items-center gap-2" data-component="recipe-status">
      {(() => {
        const s = props.status
        if (s.kind === "next")
          return (
            <span class={cn(chip, "min-w-0 bg-panel text-fg")}>
              <span class="truncate">{nextRunLabel(s.at, Date.now())}</span>
            </span>
          )
        if (s.kind === "paused")
          return (
            <>
              <span class={cn(chip, "bg-panel text-fg3")}>
                <RemixIcon icon={PauseIcon} size={12} />
                Paused
              </span>
              <span class="truncate text-hint text-fg3">{s.schedule}</span>
            </>
          )
        return <span class="truncate text-hint text-fg3">{s.label}</span>
      })()}
    </span>
  )
}

function InstallMenu(props: { install: RecipeInstall; card: RecipeCard; go: (roomId: string) => void }) {
  return (
    <MenuV2 gutter={4} placement="bottom-end">
      <MenuV2.Trigger class={cn(iconButtonClass, "rounded-full")} aria-label={`More for ${props.card.title}`}>
        <Show when={isEditing(props.card.slug)} fallback={<RemixIcon icon={MoreIcon} size={16} />}>
          <Spinner size={16} />
        </Show>
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.Item onSelect={() => props.go(props.install.roomId)}>Open chat</MenuV2.Item>
          <MenuV2.Item onSelect={() => void editRecipe(props.card.slug, props.go)}>Edit recipe</MenuV2.Item>
          <MenuV2.Item onSelect={() => removeInstall(props.install)}>
            Remove from {agentName(props.install.agent)}
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function InstallActions(props: { install: RecipeInstall; card: RecipeCard; go: (roomId: string) => void }) {
  const status = () => installStatus(props.install, props.card)
  return (
    <span class="relative flex shrink-0 items-center gap-0.5">
      <Show when={status().kind !== "ask"}>
        <button
          type="button"
          class={pillClass}
          data-action="recipe-pause"
          onClick={() => setInstallPaused(props.install, status().kind === "next")}
        >
          {status().kind === "next" ? "Pause" : "Resume"}
        </button>
      </Show>
      <InstallMenu install={props.install} card={props.card} go={props.go} />
    </span>
  )
}

function Runner(props: { install: RecipeInstall }) {
  return (
    <Show when={targetsForChat(props.install.roomId).length > 1}>
      <span class="flex shrink-0 items-center gap-1 text-hint text-fg">
        <IdentityAvatar seed={props.install.agent} size={16} />
        {agentName(props.install.agent)}
      </span>
    </Show>
  )
}

export function InstallCard(props: { install: RecipeInstall; card: RecipeCard }) {
  const chatName = () => room.chatById(props.install.roomId)?.name ?? agentName(props.install.agent)
  const status = () => installStatus(props.install, props.card)
  const on = () => status().kind === "next"
  const sinceFresh = freshElapsed(props.install.slug)
  const note = () => {
    const s = status()
    return s.kind === "next" ? nextRunLabel(s.at, Date.now()) : s.kind === "paused" ? "Paused" : undefined
  }
  return (
    <article
      class="tpl group flex min-w-0 items-center gap-4 p-3.5"
      data-install={props.install.installId}
      data-status={status().kind}
      data-fresh={sinceFresh === undefined ? undefined : ""}
      style={sinceFresh === undefined ? undefined : { "--fresh-skip": `-${sinceFresh}ms` }}
    >
      <span class="tpl-tile">
        <svg
          class="tpl-glyph"
          viewBox="0 0 256 256"
          fill="currentColor"
          aria-hidden="true"
          innerHTML={props.card.glyph}
        />
      </span>
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left outline-none after:absolute after:inset-0 after:rounded-[inherit]"
        data-action="open-recipe-chat"
        aria-label={`Open ${chatName()}`}
        onClick={() => openChat(props.install.roomId)}
      >
        <span class="truncate type-ui font-semibold text-fg">{props.card.title}</span>
        <span class="type-row truncate text-fg3">{props.card.description}</span>
        <span class="type-label mt-0.5 flex min-w-0 items-center gap-2 text-fg4">
          <RemixIcon icon={ClockIcon} size={16} class="shrink-0" />
          <span class="truncate">{localizeWhen(props.card.when)}</span>
          <ChatAvatar faces={room.chatFaces(props.install.roomId)} size={18} />
          <span class="truncate">{chatName()}</span>
        </span>
      </button>
      <span class="relative z-[1] flex shrink-0 items-center gap-3">
        <Show when={note()}>
          {(text) => (
            <span class="type-label hidden text-fg3 @min-[560px]/page:block" data-component="recipe-status">
              {text()}
            </span>
          )}
        </Show>
        <Show when={status().kind !== "ask"}>
          <button
            type="button"
            role="switch"
            aria-checked={on()}
            aria-label={`${on() ? "Pause" : "Resume"} ${props.card.title}`}
            class="tpl-switch cursor-pointer outline-none active:scale-[0.97]"
            data-action="recipe-pause"
            onClick={() => setInstallPaused(props.install, on())}
          />
        </Show>
        <span class="opacity-0 transition-opacity duration-(--dur-hover) group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100">
          <InstallMenu install={props.install} card={props.card} go={openChat} />
        </span>
      </span>
    </article>
  )
}

export function InstallRow(props: { install: RecipeInstall; card: RecipeCard; navigate: (roomId: string) => void }) {
  const title = () => room.chatById(props.install.roomId)?.name ?? agentName(props.install.agent)
  return (
    <div
      class="flex items-center gap-2 rounded-pop px-2.5 py-2 hover:bg-hover"
      data-install={props.install.installId}
      data-status={installStatus(props.install, props.card).kind}
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none"
        data-action="open-recipe-chat"
        onClick={() => props.navigate(props.install.roomId)}
      >
        <ChatAvatar faces={room.chatFaces(props.install.roomId)} size={36} />
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="type-row truncate font-medium text-fg">{title()}</span>
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
