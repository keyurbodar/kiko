import { Blobatar } from "@blobatar/solid"
import { sleepy, thinking } from "blobatar/expression"
import { For, Show, type JSX } from "solid-js"
import type { BotPresence, RosterBot } from "../lib/types"
import "blobatar/motion.css"

const PRESENCE: Record<BotPresence, { label: string; tone: string }> = {
  idle: { label: "online", tone: "data-tone-accent" },
  typing: { label: "thinking", tone: "" },
  working: { label: "thinking", tone: "" },
  sleeping: { label: "offline", tone: "data-tone-muted" },
}

export function BotAvatar(props: {
  name: string
  src?: string
  presence?: BotPresence
  size: number
}): JSX.Element {
  const state = () => (props.presence ? PRESENCE[props.presence] : null)
  const thinking_ = () => props.presence === "typing" || props.presence === "working"
  const expression = () => {
    if (props.presence === "sleeping") return sleepy
    return thinking_() ? thinking : undefined
  }

  return (
    <span
      data-component="roster-avatar"
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
      role="img"
      aria-label={state() ? `${props.name}, ${state()!.label}` : props.name}
    >
      <span data-slot="roster-avatar-face">
        <Show
          when={props.src}
          fallback={
            <Blobatar
              name={props.name}
              animate="always"
              expression={expression()}
              aria-hidden="true"
            />
          }
        >
          {(src) => <img src={src()} alt="" draggable={false} />}
        </Show>
      </span>
      <Show when={props.presence !== undefined && !thinking_()}>
        <span data-slot="roster-avatar-dot" data-tone={state()!.tone} />
      </Show>
    </span>
  )
}

export function GroupMemberStack(props: {
  group: { memberIds: readonly string[] }
  bots: () => readonly RosterBot[]
  size: number
}): JSX.Element {
  const member = (id: string) => props.bots().find((bot) => bot.id === id)
  const itemSize = Math.round(props.size * 0.66)

  return (
    <span
      data-slot="roster-avatar-stack"
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
      role="img"
      aria-label={props.group.memberIds.map((id) => member(id)?.name ?? id).join(", ")}
    >
      <For each={props.group.memberIds.slice(0, 3)}>
        {(memberId, index) => (
          <span data-slot="roster-avatar-item" data-position={index() + 1}>
            <BotAvatar
              name={member(memberId)?.name ?? memberId}
              src={member(memberId)?.avatarImage}
              size={itemSize}
            />
          </span>
        )}
      </For>
    </span>
  )
}
