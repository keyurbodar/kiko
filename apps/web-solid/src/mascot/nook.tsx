import { For, onCleanup, onMount } from "solid-js"
import { Bird } from "./bird"
import { startSnow } from "./snow"
import "./nook.css"

/*
 * The empty chat: Yuki's window nook. A warm room drawn in the birds' ink. Outside a big window
 * snow falls on a cool blue evening, over pines and soft hills. Inside, a candle on a stack of
 * books is the one light, pooling amber across a wooden sill. Yuki sits on a cushion with a cup
 * of tea beside it, steam curling up; now and then it sips, looks out at the snow, or dozes. Any
 * other birds in the chat sit along the sill with it.
 *
 * Cozy by the book: safety (a room, not the open night), abundance (tea, a candle, books, a
 * plant), softness (low contrast, warm light, slow motion), and the warm-inside, cold-outside
 * contrast. Motion is ambient only: snow, steam, a candle's flicker, breathing, a sip. Nothing
 * travels and nothing performs. Reduced motion leaves the room still.
 */

/** The drawing's box; everything below is placed in these units. */
const VW = 900
const VH = 312
const GLASS = { x: 244, y: 28, w: 412, h: 222 }
const SILL = 266
const FLAME = { x: 631, y: 213 }

type Spot = { x: number; size: number; cup?: boolean }
/** Where birds sit on the sill: the chief on its cushion with the cup, friends either side. */
const SPOTS: Spot[] = [
  { x: 430, size: 104, cup: true },
  { x: 350, size: 70 },
  { x: 570, size: 70 },
]

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`

/** Fairy lights draped under the rod: the wire's sag, and a bulb every so often along it. */
const WIRE = "M172 12 Q260 46 348 18 Q450 52 552 18 Q640 46 728 12"
const BULBS: [number, number][] = [
  [204, 25], [238, 33], [278, 33], [316, 25], [380, 28], [420, 36], [480, 36], [520, 28], [584, 25], [622, 33], [662, 33], [698, 24],
]

/** A pine on the far bank: three stacked tiers with snow on their tips. */
function pine(x: number, base: number, h: number): string {
  const tiers = [0, 0.32, 0.6].map((k, i) => {
    const w = h * (0.62 - i * 0.14)
    const top = base - h + h * k * 0.55
    const bottom = base - h * k * 0.62
    return `M${x} ${top} L${x + w / 2} ${bottom} L${x - w / 2} ${bottom}Z`
  })
  return tiers.join(" ")
}
const PINES: [number, number, number][] = [
  [296, 238, 42],
  [326, 241, 28],
  [566, 236, 48],
  [604, 241, 31],
  [632, 240, 22],
]

// ----- what the birds do ---------------------------------------------------------------

type Face = "" | "happy" | "open" | "closed"
type Pose = { tilt: number; lookX: number; lookY: number; face: Face }
type Activity = { name: string; dur: [number, number]; pose: (p: number) => Pose; weight: number; cup?: boolean }

const REST: Pose = { tilt: 0, lookX: 0, lookY: 0, face: "" }

const ACTIVITIES: Activity[] = [
  // Gazing out at the snow, up and to the window.
  { name: "gaze", weight: 4, dur: [5000, 8000], pose: (p) => ({ tilt: -3, lookX: -0.4 + Math.sin(p * Math.PI * 1.5) * 0.5, lookY: -2, face: "" }) },
  // A sip: lean over to the cup, sip, sit back content.
  {
    name: "sip",
    weight: 3,
    cup: true,
    dur: [3200, 3600],
    pose: (p) =>
      p < 0.3
        ? { tilt: 11 * (p / 0.3), lookX: 1.6, lookY: 0.8, face: "" }
        : p < 0.55
          ? { tilt: 11, lookX: 1.6, lookY: 1, face: "closed" }
          : { tilt: 11 * Math.max(0, 1 - (p - 0.55) / 0.3), lookX: 0.4, lookY: 0, face: p < 0.92 ? "happy" : "" },
  },
  // Just sitting, warm, blinking now and then.
  { name: "rest", weight: 3, dur: [3000, 5000], pose: () => REST },
  // A short doze, the head nodding a little.
  { name: "doze", weight: 1, dur: [4500, 6500], pose: (p) => ({ tilt: Math.sin(Math.min(1, p * 1.4) * Math.PI) * -4, lookX: 0, lookY: 0.5, face: p > 0.08 && p < 0.92 ? "closed" : "" }) },
  // A glance along the sill at whoever sits there.
  { name: "glance", weight: 2, dur: [2200, 3200], pose: (p) => ({ tilt: 0, lookX: Math.sin(p * Math.PI) * 1.8, lookY: 0, face: "" }) },
]

const pick = (hasCup: boolean, last: string): Activity => {
  const pool = ACTIVITIES.filter((a) => (hasCup || !a.cup) && a.name !== last)
  let roll = Math.random() * pool.reduce((n, a) => n + a.weight, 0)
  for (const a of pool) if ((roll -= a.weight) <= 0) return a
  return pool[0]!
}

type Sitter = { el: HTMLSpanElement; cup: boolean; act: Activity; at: number; until: number; now: Pose; side: number }

function live(sitters: Sitter[]): () => void {
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {}
  let raf = 0
  const tick = (t: number) => {
    raf = requestAnimationFrame(tick)
    if (document.hidden) return
    for (const s of sitters) {
      if (t >= s.until) {
        s.act = pick(s.cup, s.act.name)
        s.at = t
        s.until = t + s.act.dur[0] + Math.random() * (s.act.dur[1] - s.act.dur[0])
      }
      const want = s.act.pose((t - s.at) / (s.until - s.at))
      // Ease toward the pose, so every change of mind is soft.
      const k = 0.08
      s.now = {
        tilt: s.now.tilt + (want.tilt - s.now.tilt) * k,
        lookX: s.now.lookX + (want.lookX * (s.act.name === "glance" ? s.side : 1) - s.now.lookX) * k,
        lookY: s.now.lookY + (want.lookY - s.now.lookY) * k,
        face: want.face,
      }
      s.el.style.setProperty("--tilt", `${s.now.tilt.toFixed(2)}deg`)
      s.el.style.setProperty("--look-x", `${s.now.lookX.toFixed(2)}px`)
      s.el.style.setProperty("--look-y", `${s.now.lookY.toFixed(2)}px`)
      if (want.face) s.el.dataset.face = want.face
      else delete s.el.dataset.face
    }
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

// ----- the room ---------------------------------------------------------------------

export function Nook(props: { faces: readonly string[] }) {
  const faces = () => props.faces.slice(0, 3)
  let snow: HTMLCanvasElement | undefined
  const birds: HTMLSpanElement[] = []

  onMount(() => {
    const stopSnow = startSnow(snow!, { density: 5, sizes: [0.7, 2.4], alpha: [0.35, 0.95], speed: 0.8, bokeh: 0 })
    const now = performance.now()
    const sitters: Sitter[] = birds.map((el, i) => ({
      el,
      cup: SPOTS[i]!.cup ?? false,
      act: ACTIVITIES[0]!,
      at: now,
      until: now + 2500 + i * 1700,
      now: REST,
      side: SPOTS[i]!.x < SPOTS[0]!.x ? 1 : -1,
    }))
    const stopLive = live(sitters)
    onCleanup(() => (stopSnow(), stopLive()))
  })

  return (
    <div class="nook" data-component="nook" aria-hidden="true">
      {/* Outside: the evening, the far bank and its pines, seen only through the glass. */}
      <svg class="nook-layer" viewBox={`0 0 ${VW} ${VH}`}>
        <defs>
          <clipPath id="nook-glass">
            <rect x={GLASS.x} y={GLASS.y} width={GLASS.w} height={GLASS.h} />
          </clipPath>
          <linearGradient id="nook-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--nook-sky-top)" />
            <stop offset="1" stop-color="var(--nook-sky-bottom)" />
          </linearGradient>
          <radialGradient id="nook-moonglow">
            <stop offset="0" stop-color="var(--nook-moon)" stop-opacity=".35" />
            <stop offset="1" stop-color="var(--nook-moon)" stop-opacity="0" />
          </radialGradient>
        </defs>
        <g clip-path="url(#nook-glass)">
          <rect x={GLASS.x} y={GLASS.y} width={GLASS.w} height={GLASS.h} fill="url(#nook-sky)" />
          <circle cx="588" cy="72" r="46" fill="url(#nook-moonglow)" />
          <circle class="nook-moon" cx="588" cy="72" r="14" />
          <path class="nook-hill" d="M244 216 C300 198 360 208 420 200 C490 190 560 206 656 194 L656 250 L244 250Z" />
          <For each={PINES}>{([x, base, h]) => <path class="nook-pine" d={pine(x, base, h)} />}</For>
          <path class="nook-ground" d="M244 238 C330 228 420 240 500 234 C570 229 620 238 656 232 L656 250 L244 250Z" />
        </g>
      </svg>
      <canvas
        ref={snow}
        class="nook-snow"
        style={{ left: pct(GLASS.x, VW), top: pct(GLASS.y, VH), width: pct(GLASS.w, VW), height: pct(GLASS.h, VH) }}
      />
      {/* Inside: the candle's light, the window, the curtains, the sill and what is on it. */}
      <svg class="nook-layer" viewBox={`0 0 ${VW} ${VH}`}>
        <defs>
          <radialGradient id="nook-candlelight">
            <stop offset="0" stop-color="var(--nook-flame)" stop-opacity=".3" />
            <stop offset=".35" stop-color="var(--nook-flame)" stop-opacity=".08" />
            <stop offset="1" stop-color="var(--nook-flame)" stop-opacity="0" />
          </radialGradient>
          <filter id="nook-rough" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="9" />
            <feDisplacementMap in="SourceGraphic" scale="1.6" />
          </filter>
        </defs>
        <g class="nook-ink" filter="url(#nook-rough)">
          {/* The window frame and its cross of glazing bars. */}
          <path class="nook-wood" fill-rule="evenodd" d={`M230 28 Q230 14 244 14 H656 Q670 14 670 28 V264 H230Z M${GLASS.x} ${GLASS.y} V${GLASS.y + GLASS.h} H${GLASS.x + GLASS.w} V${GLASS.y}Z`} />
          <rect class="nook-wood" x="446.5" y={GLASS.y} width="7" height={GLASS.h} />
          <rect class="nook-wood" x={GLASS.x} y="136" width={GLASS.w} height="7" />
          <path class="nook-shine" d="M262 112 L300 52 M276 118 L304 74 M472 116 L506 62 M480 236 L506 196" />
          {/* The curtains, drawn back and tied. */}
          <path class="nook-rod" d="M158 9 H742" />
          <circle class="nook-wood" cx="156" cy="9" r="4.5" />
          <circle class="nook-wood" cx="744" cy="9" r="4.5" />
          <For each={[false, true]}>
            {(mirror) => (
              <g transform={mirror ? `translate(${VW} 0) scale(-1 1)` : undefined}>
                <path class="nook-curtain" d="M168 9 H262 C258 60 250 120 244 168 C252 204 262 244 268 288 H176 C182 232 186 200 182 168 C176 120 172 60 168 9Z" />
                <path class="nook-fold" d="M194 14 C198 70 202 130 198 166 M220 14 C224 70 226 128 222 166 M198 176 C202 222 204 252 206 284 M230 176 C236 222 242 252 246 286" />
                <ellipse class="nook-tie" cx="213" cy="169" rx="34" ry="5.5" />
              </g>
            )}
          </For>
          {/* The sill. */}
          <path class="nook-sill-top" d={`M188 ${SILL - 4} H712 L722 ${SILL + 4} H178Z`} />
          <rect class="nook-sill" x="178" y={SILL + 4} width="544" height="15" rx="2" />
          {/* A teapot with a bamboo handle. */}
          <path class="nook-handle" d="M252 233 C254 214 282 214 284 233" />
          <path class="nook-teapot" d="M247 244 C238 240 233 234 230 227 L234.5 225.5 C237 232 242 236 249 239Z" />
          <ellipse class="nook-teapot" cx="268" cy="248" rx="23" ry="18" />
          <ellipse class="nook-teapot-lid" cx="268" cy="232" rx="10" ry="3.4" />
          <circle class="nook-teapot-lid" cx="268" cy="228" r="3" />
          {/* The chief's cushion. */}
          <ellipse class="nook-cushion" cx="430" cy={SILL - 2} rx="54" ry="7.5" />
          {/* A cup of tea. */}
          <path class="nook-cup" d={`M484 246 L486.5 ${SILL - 1} H501.5 L504 246Z`} />
          <ellipse class="nook-cup" cx="494" cy="246" rx="10" ry="2.6" />
          <ellipse class="nook-tea" cx="494" cy="246.3" rx="7.6" ry="1.7" />
          {/* Books, a candle on them. */}
          <rect class="nook-book-a" x="604" y={SILL - 14} width="56" height="13" rx="2" />
          <rect class="nook-book-b" x="609" y={SILL - 25} width="46" height="11" rx="2" />
          <path class="nook-pages" d={`M612 ${SILL - 8} H652 M616 ${SILL - 19} H648`} />
          <rect class="nook-candle" x="624" y="221" width="14" height="21" rx="2" />
          <path class="nook-wick" d="M631 221 V217" />
          {/* A little plant, trailing over the edge. */}
          <path class="nook-pot" d={`M680 248 L683 ${SILL - 1} H701 L704 248Z`} />
          <path class="nook-leaf" d="M692 247 C684 236 686 226 692 222 C698 228 699 238 692 247Z M692 247 C700 238 710 236 714 240 C710 248 700 250 692 247Z M692 247 C684 242 674 242 671 247 C676 253 686 252 692 247Z M703 250 C712 256 714 266 710 276 C704 272 702 262 703 250Z" />
        </g>
        {/* The candle's light over everything, its flame, and the tea's steam: soft, so no ink. */}
        <circle class="nook-glow" cx={FLAME.x} cy={FLAME.y} r="170" fill="url(#nook-candlelight)" />
        <path class="nook-wire" d={WIRE} />
        <For each={BULBS}>
          {([x, y], i) => (
            <g class="nook-bulb" style={{ "animation-delay": `${(i() * 1.37) % 5}s` }}>
              <circle cx={x} cy={y + 3} r="7" class="nook-bulb-glow" />
              <ellipse cx={x} cy={y + 3} rx="2.4" ry="3.2" class="nook-bulb-glass" />
            </g>
          )}
        </For>
        <path class="nook-flame" d={`M${FLAME.x} ${FLAME.y - 8} C${FLAME.x + 4} ${FLAME.y - 3} ${FLAME.x + 3.5} ${FLAME.y + 3} ${FLAME.x} ${FLAME.y + 3.5} C${FLAME.x - 3.5} ${FLAME.y + 3} ${FLAME.x - 4} ${FLAME.y - 3} ${FLAME.x} ${FLAME.y - 8}Z`} />
        <g class="nook-steam">
          <path d="M489 241 c-4 -6 4 -10 0 -16 c-4 -6 4 -10 0 -16" />
          <path d="M495 240 c-4 -6 4 -10 0 -16 c-4 -6 4 -10 0 -16" />
          <path d="M500 241 c-4 -6 4 -10 0 -16 c-4 -6 4 -10 0 -16" />
        </g>
      </svg>
      <For each={faces()}>
        {(slug, i) => {
          const spot = SPOTS[i()]!
          return (
            <span
              class="nook-bird"
              style={{ left: pct(spot.x - spot.size / 2, VW), top: pct(SILL - 0.75 * spot.size + 3, VH), width: pct(spot.size, VW) }}
            >
              <Bird slug={slug} size={spot.size} alive expressive ref={(el) => (birds[i()] = el)} />
            </span>
          )
        }}
      </For>
    </div>
  )
}
