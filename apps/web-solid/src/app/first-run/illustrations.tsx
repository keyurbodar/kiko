import type { JSX } from "solid-js"

export type IllustrationName = "envelope" | "plug" | "pot" | "chat"

const LINE = {
  stroke: "var(--fg)",
  "stroke-width": 3.2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
} as const

function Drawing(props: { id: string; seed: number; children: JSX.Element }) {
  return (
    <svg class="ob-art" width="285" height="285" viewBox="0 0 150 150" aria-hidden="true">
      <defs>
        <filter id={props.id} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed={props.seed} />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
      </defs>
      <g filter={`url(#${props.id})`}>{props.children}</g>
    </svg>
  )
}

const FILL = "var(--active)"
const FILL_DEEP = "var(--hover)"

function Envelope() {
  return (
    <Drawing id="ob-envelope" seed={6}>
      <rect class="ob-draw" pathLength="1" x="24" y="44" width="102" height="70" rx="8" fill={FILL} {...LINE} />
      <path class="ob-draw" pathLength="1" d="M26 48 l49 36 l49 -36" fill="none" {...LINE} />
      <g class="ob-pop">
        <circle cx="112" cy="44" r="16" fill={FILL_DEEP} {...LINE} />
        <path d="M105 44 l5 5 l9 -10" fill="none" {...LINE} />
      </g>
    </Drawing>
  )
}

function Plug() {
  return (
    <Drawing id="ob-plug" seed={3}>
      <g class="ob-reach">
        <path class="ob-draw" pathLength="1" d="M38 64 h34 v22 a17 17 0 0 1 -34 0 z" fill={FILL} {...LINE} />
        <path d="M46 64 v-16 M64 64 v-16" {...LINE} />
        <path class="ob-draw" pathLength="1" d="M55 103 q0 18 22 20 q20 2 22 -14" fill="none" {...LINE} />
      </g>
      <rect class="ob-draw" pathLength="1" x="92" y="78" width="36" height="34" rx="9" fill={FILL_DEEP} {...LINE} />
      <path d="M104 92 v6 M116 92 v6" {...LINE} />
    </Drawing>
  )
}

function Pot() {
  return (
    <Drawing id="ob-pot" seed={1}>
      <path
        class="ob-draw"
        pathLength="1"
        d="M30 70 h90 v34 a20 20 0 0 1 -20 20 h-50 a20 20 0 0 1 -20 -20 z"
        fill={FILL}
        {...LINE}
      />
      <path d="M24 70 h102 M20 82 h10 M120 82 h10 M42 70 q33 -22 66 0 M75 52 v-6" fill="none" {...LINE} />
      <path
        class="ob-steam"
        d="M56 40 q-6 -10 2 -18 M75 34 q-6 -10 2 -18 M94 40 q-6 -10 2 -18"
        fill="none"
        opacity=".7"
        {...LINE}
      />
      <path d="M75 96 v-10 M75 96 l8 5" {...LINE} />
      <circle cx="75" cy="96" r="14" fill="none" {...LINE} />
    </Drawing>
  )
}

function Chat() {
  return (
    <Drawing id="ob-chat" seed={4}>
      <path
        class="ob-draw"
        pathLength="1"
        d="M24 36 h72 a12 12 0 0 1 12 12 v26 a12 12 0 0 1 -12 12 h-46 l-16 14 v-14 h-10 a12 12 0 0 1 -12 -12 v-26 a12 12 0 0 1 12 -12 z"
        fill={FILL}
        {...LINE}
      />
      <path
        class="ob-draw"
        pathLength="1"
        d="M66 92 h50 a10 10 0 0 1 10 10 v14 a10 10 0 0 1 -10 10 h-4 v12 l-14 -12 h-32 a10 10 0 0 1 -10 -10 z"
        fill={FILL_DEEP}
        {...LINE}
      />
      <path d="M40 56 h40 M40 66 h26" opacity=".7" {...LINE} />
    </Drawing>
  )
}

export function Illustration(props: { name: IllustrationName }) {
  return (
    <>
      {props.name === "envelope" ? <Envelope /> : null}
      {props.name === "plug" ? <Plug /> : null}
      {props.name === "pot" ? <Pot /> : null}
      {props.name === "chat" ? <Chat /> : null}
    </>
  )
}
