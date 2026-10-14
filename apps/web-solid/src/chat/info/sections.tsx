import type { Member } from "@kiko/protocol"
import type { JSX } from "solid-js"
import { useApp } from "../../lib/store"

/*
 * The parts of the panel, after monocode's Mono details (features/monos/ui/monoPanelParts.tsx and
 * MonoSettingsPage.tsx): a face and a name, a short list of facts, sections under a quiet
 * uppercase label and a hairline, rows that open a page, and the one destructive row at the
 * bottom. Each draws from the stores the app already holds, so opening the panel waits on nothing.
 */

/** The hairline monocode draws between the parts (`border-stroke`). */
export const EDGE = "border-[var(--panel-edge)]"

/** The facts: a label column and a value column, 12px, as monocode lists a Mono's model. */
export function Properties(props: { children: JSX.Element }) {
  return <dl class={`flex flex-col gap-0.5 border-t ${EDGE} px-4 py-3`} data-component="info-properties">{props.children}</dl>
}

export function Property(props: { label: string; field?: string; children: JSX.Element }) {
  return (
    <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start text-[12px]">
      <dt class="flex h-7 items-center text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{props.label}</dt>
      <dd class="flex min-h-7 min-w-0 items-center truncate text-[color-mix(in_oklab,var(--text)_85%,transparent)]" data-field={props.field}>
        {props.children}
      </dd>
    </div>
  )
}

/** The face and the name at the top of a page. */
export function Profile(props: { face: JSX.Element; children: JSX.Element }) {
  return (
    <header class="flex flex-col items-center gap-2 px-3 pt-6 pb-4 text-center" data-component="info-header">
      {props.face}
      {props.children}
    </header>
  )
}

/** The destructive row, alone at the bottom: red name, quiet line under it. */
export function DangerRow(props: { action: string; label: string; description: string; onClick: () => void; onBlur?: () => void }) {
  return (
    <div class="mt-auto p-2" data-card="danger">
      <button
        type="button"
        class="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-[color-mix(in_oklab,var(--text)_5%,transparent)]"
        data-action={props.action}
        onClick={() => props.onClick()}
        onBlur={() => props.onBlur?.()}
      >
        <span class="text-[13px] leading-5 text-danger">{props.label}</span>
        <span class="text-[12px] leading-5 text-[color-mix(in_oklab,var(--text)_40%,transparent)]">{props.description}</span>
      </button>
    </div>
  )
}

/*
 * ASSUMPTION: until teams (P6) a room stores no member record, and its one agent is `kiko` (the
 * server's DEFAULT_AGENT). The sidebar already falls back to that name, so the panel does too.
 */
const DEFAULT_MEMBER = { slug: "yuki" as Member["slug"], name: "Kiko", lead: true }

/** The open room's agents with pending changes applied, or the one default agent while the room lists none. */
export function roomMembers(): readonly Member[] {
  const members = useApp.roomMembers()
  return members.length ? members : [DEFAULT_MEMBER]
}
