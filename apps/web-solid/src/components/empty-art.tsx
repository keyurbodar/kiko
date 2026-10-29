import { createUniqueId, type JSX } from "solid-js"
import "./empty-art.css"

export type EmptyArtName = "pot" | "folder" | "plug" | "chats" | "notes" | "inbox" | "search"

const L = "ea-line"
const F = "ea-line ea-fill"
const F2 = "ea-line ea-fill2"

function Pot() {
  return (
    <>
      <path class={F} d="M30 70 h90 v34 a20 20 0 0 1 -20 20 h-50 a20 20 0 0 1 -20 -20 z" />
      <path class={L} d="M20 82 h10 M120 82 h10" />
      <g class="ea-lid">
        <path class={L} d="M24 70 h102" />
        <path class={L} d="M42 70 q33 -22 66 0" />
        <path class={L} d="M75 52 v-6" />
      </g>
      <path class={`${L} ea-steam ea-accent`} d="M56 40 q-6 -10 2 -18" />
      <path class={`${L} ea-steam ea-steam2 ea-accent`} d="M75 34 q-6 -10 2 -18" />
      <path class={`${L} ea-steam ea-steam3 ea-accent`} d="M94 40 q-6 -10 2 -18" />
      <circle class={L} cx="75" cy="96" r="14" />
      <path class={L} d="M75 96 l8 5" />
      <path class={`${L} ea-hand`} d="M75 96 v-10" />
    </>
  )
}

function Folder() {
  return (
    <>
      <g class="ea-peek">
        <path class={F2} d="M40 60 v-26 h52 l14 14 v12" />
        <path class={L} d="M92 34 v14 h14" />
        <path class={`${L} ea-soft ea-accent`} d="M50 46 h28 M50 54 h20" />
      </g>
      <path class={F} d="M22 50 h36 l10 10 h60 v62 h-106 z" />
      <path class={L} d="M22 72 h106" />
    </>
  )
}

function Plug() {
  return (
    <>
      <g class="ea-plug">
        <path class={F} d="M38 64 h34 v22 a17 17 0 0 1 -34 0 z" />
        <path class={L} d="M46 64 v-16 M64 64 v-16" />
      </g>
      <path class={L} d="M55 103 q0 18 22 20 q20 2 22 -14" />
      <rect class={F2} x="92" y="78" width="36" height="34" rx="9" />
      <path class={L} d="M104 92 v6 M116 92 v6" />
      <path class={`${L} ea-spark ea-accent`} d="M84 66 l-4 -8 M90 64 l2 -9 M80 74 l-8 -2" />
    </>
  )
}

function Chats() {
  return (
    <>
      <g class="ea-pop1">
        <path
          class={F}
          d="M24 36 h72 a12 12 0 0 1 12 12 v26 a12 12 0 0 1 -12 12 h-46 l-16 14 v-14 h-10 a12 12 0 0 1 -12 -12 v-26 a12 12 0 0 1 12 -12 z"
        />
        <path class={`${L} ea-draw ea-accent`} d="M40 56 h40" />
        <path class={`${L} ea-draw ea-d2 ea-accent`} d="M40 66 h26" />
      </g>
      <g class="ea-pop2">
        <path
          class={F2}
          d="M66 92 h50 a10 10 0 0 1 10 10 v14 a10 10 0 0 1 -10 10 h-4 v12 l-14 -12 h-32 a10 10 0 0 1 -10 -10 z"
        />
      </g>
    </>
  )
}

function Notes() {
  return (
    <>
      <rect class={F} x="38" y="26" width="74" height="100" rx="10" />
      <path class={`${L} ea-draw`} d="M52 50 h46" />
      <path class={`${L} ea-draw ea-d2`} d="M52 62 h46" />
      <path class={`${L} ea-draw ea-d3`} d="M52 74 h30" />
      <path class={`${F2} ea-rib ea-accent`} d="M90 26 v28 l8 -6 l8 6 v-28" />
      <path class={F2} d="M60 98 q10 -16 20 0 q-10 14 -20 0" />
    </>
  )
}

function Inbox() {
  return (
    <>
      <rect class={F} x="24" y="44" width="102" height="70" rx="8" />
      <path class={L} d="M26 48 l49 36 l49 -36" />
      <g class="ea-chk">
        <circle class={F2} cx="112" cy="44" r="16" />
        <path class={`${L} ea-tick ea-accent`} d="M105 44 l5 5 l9 -10" />
      </g>
    </>
  )
}

function Search() {
  return (
    <>
      <path class={F} d="M30 38 h54 a8 8 0 0 1 8 8 v50 a8 8 0 0 1 -8 8 h-54 a8 8 0 0 1 -8 -8 v-50 a8 8 0 0 1 8 -8 z" />
      <path class={`${L} ea-soft`} d="M34 56 h30 M34 68 h22 M34 80 h26" />
      <g class="ea-scan">
        <circle class={`${F2} ea-accent`} cx="92" cy="86" r="22" />
        <path class={`${L} ea-accent`} d="M108 102 l18 18" />
      </g>
    </>
  )
}

const ART: Record<EmptyArtName, () => JSX.Element> = {
  pot: Pot,
  folder: Folder,
  plug: Plug,
  chats: Chats,
  notes: Notes,
  inbox: Inbox,
  search: Search,
}

export function EmptyArt(props: { name: EmptyArtName; size?: number; class?: string }) {
  const id = `ea-wobble-${createUniqueId()}`
  const Art = () => ART[props.name]()
  return (
    <svg
      class={`empty-art ${props.class ?? ""}`}
      width={props.size ?? 120}
      height={props.size ?? 120}
      viewBox="0 0 150 150"
      aria-hidden="true"
      data-component="empty-art"
      data-art={props.name}
    >
      <defs>
        <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="11" />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        <Art />
      </g>
    </svg>
  )
}
