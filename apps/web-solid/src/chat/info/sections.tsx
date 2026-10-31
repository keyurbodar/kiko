import type { Member } from "@kiko/protocol"
import type { JSX } from "solid-js"
import { room } from "../../state/room"

export function Properties(props: { children: JSX.Element }) {
  return (
    <dl class="flex flex-col gap-0.5 px-4 py-3" data-component="info-properties">
      {props.children}
    </dl>
  )
}

export function Property(props: { label: string; field?: string; children: JSX.Element }) {
  return (
    <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start text-xs">
      <dt class="flex h-7 items-center text-tertiary">{props.label}</dt>
      <dd class="flex min-h-7 min-w-0 items-center truncate text-primary" data-field={props.field}>
        {props.children}
      </dd>
    </div>
  )
}

export function Profile(props: { face: JSX.Element; children: JSX.Element }) {
  return (
    <header class="flex flex-col items-center gap-2 px-3 pt-6 pb-4 text-center" data-component="info-header">
      {props.face}
      {props.children}
    </header>
  )
}

export function DangerRow(props: {
  action: string
  label: string
  description: string
  onClick: () => void
  onBlur?: () => void
}) {
  return (
    <div class="mt-auto p-2" data-card="danger">
      <button
        type="button"
        class="flex w-full flex-col rounded-base px-3 py-2 text-left hover:bg-tertiary"
        data-action={props.action}
        onClick={() => props.onClick()}
        onBlur={() => props.onBlur?.()}
      >
        <span class="text-sm text-danger">{props.label}</span>
        <span class="text-xs text-quaternary">{props.description}</span>
      </button>
    </div>
  )
}

const DEFAULT_MEMBER = { slug: "kiko" as Member["slug"], name: "Kiko", lead: true }

export function roomMembers(): readonly Member[] {
  const members = room.roomMembers()
  return members.length ? members : [DEFAULT_MEMBER]
}
