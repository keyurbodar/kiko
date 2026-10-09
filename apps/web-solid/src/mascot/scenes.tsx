// Four directions for the empty chat, side by side and live, to pick one. Each is a slice of a
// Japanese winter with its own palette: an ukiyo-e night snow, an onsen, a kotatsu, and a snow
// lantern garden. Open /src/mascot/scenes.html on the dev server.

import { For, onCleanup, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import "../styles/app.css"
import { Bird } from "./bird"
import { startSnow } from "./snow"
import "./scenes.css"

const VW = 900
const VH = 360
const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`

// ----- birds that live a little: look around, close their eyes, beam, lean in -----------------

type Mood = { tilt: number; x: number; y: number; face: "" | "happy" | "closed" }
type Liver = { el: HTMLSpanElement; mood: Mood; want: Mood; until: number; lean: number; calm: boolean }

const MOODS = (lean: number, calm: boolean): Mood[] => [
  { tilt: 0, x: 0, y: 0, face: "" },
  { tilt: -3, x: -1.2, y: -1.4, face: "" },
  { tilt: 3, x: 1.2, y: -0.6, face: "" },
  { tilt: lean * 7, x: lean * 1.6, y: 0.2, face: "happy" },
  { tilt: 0, x: 0, y: 0.4, face: calm ? "closed" : "happy" },
  ...(calm ? [{ tilt: -2, x: 0, y: 0.6, face: "closed" as const }] : []),
]

function animate(birds: HTMLSpanElement[], opts: { leans?: number[]; calm?: boolean } = {}): () => void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {}
  const now = performance.now()
  const livers: Liver[] = birds.map((el, i) => ({ el, mood: MOODS(0, false)[0]!, want: MOODS(0, false)[0]!, until: now + 800 + i * 900, lean: opts.leans?.[i] ?? 0, calm: opts.calm ?? false }))
  let raf = 0
  const tick = (t: number) => {
    raf = requestAnimationFrame(tick)
    for (const l of livers) {
      if (t > l.until) {
        const pool = MOODS(l.lean, l.calm)
        l.want = pool[Math.floor(Math.random() * pool.length)]!
        l.until = t + 1800 + Math.random() * 3400
      }
      const k = 0.07
      l.mood = { tilt: l.mood.tilt + (l.want.tilt - l.mood.tilt) * k, x: l.mood.x + (l.want.x - l.mood.x) * k, y: l.mood.y + (l.want.y - l.mood.y) * k, face: l.want.face }
      l.el.style.setProperty("--tilt", `${l.mood.tilt.toFixed(2)}deg`)
      l.el.style.setProperty("--look-x", `${l.mood.x.toFixed(2)}px`)
      l.el.style.setProperty("--look-y", `${l.mood.y.toFixed(2)}px`)
      if (l.mood.face) l.el.dataset.face = l.mood.face
      else delete l.el.dataset.face
    }
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

/** A bird sitting with its base at (x, base) in the scene's units. */
function Sitter(props: { slug: string; x: number; base: number; size: number; ref: (el: HTMLSpanElement) => void; z?: number }) {
  return (
    <span class="scene-bird" style={{ left: pct(props.x - props.size / 2, VW), top: pct(props.base - 0.75 * props.size, VH), width: pct(props.size, VW), "z-index": props.z ?? 2 }}>
      <Bird slug={props.slug} size={props.size} alive expressive ref={props.ref} />
    </span>
  )
}

/** Snow across a scene, or inside part of it. */
function Snow(props: { box?: { x: number; y: number; w: number; h: number }; crisp?: boolean; density?: number; round?: boolean }) {
  let c: HTMLCanvasElement | undefined
  onMount(() => onCleanup(startSnow(c!, { density: props.density ?? 1.4, sizes: props.crisp ? [1.2, 2.6] : [0.7, 2.4], alpha: props.crisp ? [0.85, 1] : [0.4, 0.95], speed: 0.7, bokeh: 0 })))
  const b = () => props.box ?? { x: 0, y: 0, w: VW, h: VH }
  return <canvas ref={c} class="scene-snow" classList={{ round: props.round }} style={{ left: pct(b().x, VW), top: pct(b().y, VH), width: pct(b().w, VW), height: pct(b().h, VH) }} />
}

const Stage = (props: { children: JSX.Element; class: string }) => <div class={`scene ${props.class}`}>{props.children}</div>
const Layer = (props: { children: JSX.Element; z?: number }) => (
  <svg class="scene-layer" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice" style={{ "z-index": props.z ?? 1 }}>
    {props.children}
  </svg>
)

const flatPine = (x: number, base: number, h: number) =>
  [0, 1, 2]
    .map((i) => {
      const w = h * (0.7 - i * 0.18)
      const top = base - h + i * h * 0.22
      const bottom = base - i * h * 0.24
      return `M${x} ${top} L${x + w / 2} ${bottom} L${x - w / 2} ${bottom}Z`
    })
    .join(" ")

// ----- 1. Ukiyo-e night snow ---------------------------------------------------------------

function Ukiyoe() {
  const birds: HTMLSpanElement[] = []
  onMount(() => onCleanup(animate(birds, { leans: [1, 0, -1] })))
  return (
    <Stage class="ukiyoe">
      <Layer>
        <defs>
          <linearGradient id="uk-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#14203a" />
            <stop offset=".5" stop-color="#2b4670" />
            <stop offset=".72" stop-color="#8fa4be" />
            <stop offset=".8" stop-color="#e8e2d4" />
          </linearGradient>
        </defs>
        <rect width={VW} height={VH} fill="url(#uk-sky)" />
        <path d="M520 262 L648 150 L780 262Z" fill="#9fb0c6" />
        <path d="M606 187 L648 150 L690 187 L678 183 L666 192 L654 181 L642 193 L630 182 L618 190Z" fill="#f4f0e6" />
        <path d="M0 266 C200 254 400 262 600 256 C750 252 850 260 900 258 V360 H0Z" fill="#efe9dc" />
        <path d="M0 310 C220 298 460 312 900 300 V360 H0Z" fill="#c4cfdc" />
        <path d="M0 336 C260 326 520 340 900 330 V360 H0Z" fill="#e8e2d6" />
        <For each={[[120, 268, 70], [168, 270, 46], [770, 266, 64], [812, 270, 40]] as const}>
          {([x, b, h]) => (
            <>
              <path d={flatPine(x, b, h)} fill="#1b2638" />
              <path d={`M${x - h * 0.3} ${b - h * 0.48} q${h * 0.3} -6 ${h * 0.6} 0 M${x - h * 0.22} ${b - h * 0.72} q${h * 0.22} -5 ${h * 0.44} 0`} stroke="#f4f0e6" stroke-width="4" stroke-linecap="round" fill="none" />
            </>
          )}
        </For>
      </Layer>
      <Snow crisp density={1.1} />
      <Layer z={3}>
        <path d="M-10 78 C140 72 260 108 420 114 C520 118 600 106 712 128 L714 138 C600 118 520 130 420 126 C260 122 140 92 -10 94Z" fill="#1c1a20" />
        <path d="M180 92 C200 70 214 56 236 48 M560 116 C580 96 600 88 626 86 M300 112 C306 132 312 146 322 156" stroke="#1c1a20" stroke-width="4" stroke-linecap="round" fill="none" />
        <path d="M14 76 C140 68 260 102 420 108 C520 112 600 100 700 122 C600 110 520 118 420 117 C260 112 140 82 14 82Z" fill="#f6f2ea" />
        <rect x="40" y="128" width="34" height="132" fill="#f1eadb" stroke="#1c1a20" stroke-width="1.2" />
        <text x="57" y="148" class="uk-title">雪のえなが</text>
        <rect x="830" y="306" width="34" height="34" rx="3" fill="#c3402e" />
        <text x="847" y="331" class="uk-seal">雪</text>
      </Layer>
      <For each={[["matcha", 330, 70], ["yuki", 404, 82], ["sakura", 480, 70]] as const}>
        {([slug, x, size], i) => <Sitter slug={slug} x={x} base={x < 400 ? 114 : x > 420 ? 120 : 117} size={size} z={4} ref={(el) => (birds[i()] = el)} />}
      </For>
    </Stage>
  )
}

// ----- 2. Onsen ------------------------------------------------------------------------

function Onsen() {
  const birds: HTMLSpanElement[] = []
  onMount(() => onCleanup(animate(birds, { calm: true, leans: [1, 0, -1] })))
  const WATER = 262
  return (
    <Stage class="onsen">
      <Layer>
        <defs>
          <linearGradient id="on-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#0f1b20" />
            <stop offset="1" stop-color="#1f3438" />
          </linearGradient>
          <radialGradient id="on-lamp">
            <stop offset="0" stop-color="#f6c66e" stop-opacity=".55" />
            <stop offset="1" stop-color="#f6c66e" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="on-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#5fb0aa" />
            <stop offset="1" stop-color="#2c6c6b" />
          </linearGradient>
        </defs>
        <rect width={VW} height={VH} fill="url(#on-sky)" />
        <g fill="#8c7f52">
          <For each={Array.from({ length: 50 }, (_, i) => i)}>{(i) => <rect x={110 + i * 14} y={i % 2 ? 128 : 122} width="12" height={i % 2 ? 132 : 138} rx="3" opacity={i % 3 ? 1 : 0.85} />}</For>
        </g>
        <rect x="104" y="160" width="704" height="5" rx="2" fill="#5c4d35" />
        <rect x="104" y="222" width="704" height="5" rx="2" fill="#5c4d35" />
        <path d="M104 124 C200 112 300 126 420 116 C540 108 680 124 808 114 L808 126 C680 132 540 118 420 126 C300 134 200 122 104 130Z" fill="#eef2f3" />
        <circle cx="162" cy="200" r="90" fill="url(#on-lamp)" class="scene-flicker" />
        <rect x="150" y="226" width="24" height="44" fill="#6b6f70" />
        <rect x="142" y="186" width="40" height="40" rx="3" fill="#7a7f80" />
        <rect x="152" y="194" width="20" height="24" fill="#f6c66e" class="scene-flicker" />
        <path d="M128 188 L162 162 L196 188Z" fill="#6b6f70" />
        <path d="M134 184 C146 172 178 172 190 184 L162 160Z" fill="#eef2f3" />
        <path d="M150 262 C170 238 260 232 320 240 C420 226 560 228 650 238 C710 232 760 244 770 262Z" fill="#555c60" />
        <path d="M168 246 q20 -10 40 -2 M330 236 q30 -8 60 0 M560 232 q30 -8 62 0 M700 240 q20 -8 40 0" stroke="#eef2f3" stroke-width="6" stroke-linecap="round" fill="none" />
        <ellipse cx="460" cy={WATER + 30} rx="300" ry="42" fill="url(#on-water)" />
      </Layer>
      <Snow density={1.2} />
      <For each={[["peach", 368, 76], ["yuki", 456, 88], ["ramune", 546, 76]] as const}>
        {([slug, x, size], i) => <Sitter slug={slug} x={x} base={WATER + 9} size={size} ref={(el) => (birds[i()] = el)} />}
      </For>
      <Layer z={3}>
        {/* The water's surface over the birds' bellies, the near rocks, a towel, yuzu, and steam. */}
        <path d={`M160 ${WATER} C260 ${WATER - 6} 660 ${WATER - 6} 760 ${WATER} C740 ${WATER + 70} 180 ${WATER + 70} 160 ${WATER}Z`} fill="#3f8b88" opacity=".93" />
        <path d={`M300 ${WATER + 4} q20 -4 40 0 M420 ${WATER + 3} q30 -4 60 0 M580 ${WATER + 4} q20 -4 40 0`} stroke="#bfe6e1" stroke-opacity=".6" stroke-width="2" fill="none" class="scene-ripple" />
        <path d="M120 300 C150 282 230 286 260 300 C300 292 360 296 380 312 C440 300 520 302 560 314 C620 298 700 300 740 304 C790 290 830 300 840 320 V360 H100 V320Z" fill="#4a5155" />
        <path d="M160 296 q40 -12 80 0 M410 306 q60 -10 120 0 M690 300 q50 -10 100 2" stroke="#eef2f3" stroke-width="7" stroke-linecap="round" fill="none" />
        <g transform="translate(440 216) rotate(-6 16 5)">
          <rect x="0" y="0" width="32" height="10" rx="3" fill="#fbf7f0" stroke="#2b2824" stroke-width="1.4" />
          <path d="M8 1 V9 M16 1 V9 M24 1 V9" stroke="#6e8fb3" stroke-width="2" />
        </g>
        <g class="scene-bob">
          <circle cx="292" cy={WATER + 6} r="9" fill="#f2c14e" stroke="#2b2824" stroke-width="1.3" />
          <path d="M292 255 q4 -6 9 -4" stroke="#6e8a58" stroke-width="2" fill="none" />
        </g>
        <g class="scene-bob" style={{ "animation-delay": "-1.3s" }}>
          <circle cx="630" cy={WATER + 8} r="8" fill="#f2c14e" stroke="#2b2824" stroke-width="1.3" />
        </g>
        <g class="scene-bob" style={{ "animation-delay": "-2.1s" }}>
          <rect x="660" y={WATER - 2} width="40" height="9" rx="2" fill="#a07850" stroke="#2b2824" stroke-width="1.2" />
          <path d={`M670 ${WATER - 2} v-12 q4 -4 8 0 v12Z`} fill="#fbf7f0" stroke="#2b2824" stroke-width="1.2" />
          <rect x="684" y={WATER - 8} width="7" height="6" rx="1" fill="#fbf7f0" stroke="#2b2824" stroke-width="1" />
        </g>
        <g class="scene-steam" stroke="#eef6f5">
          <For each={[300, 380, 470, 560, 640]}>{(x, i) => <path d={`M${x} ${WATER - 4} c-8 -12 8 -20 0 -32 c-8 -12 8 -20 0 -32`} style={{ "animation-delay": `${i() * 0.9}s` }} />}</For>
        </g>
      </Layer>
    </Stage>
  )
}

// ----- 3. Kotatsu ----------------------------------------------------------------------

function Kotatsu() {
  const birds: HTMLSpanElement[] = []
  onMount(() => onCleanup(animate(birds, { calm: true, leans: [0, 1, -1] })))
  return (
    <Stage class="kotatsu">
      <Layer>
        <defs>
          <radialGradient id="ko-warm" cx=".5" cy=".4" r=".7">
            <stop offset="0" stop-color="#f7e4bf" />
            <stop offset="1" stop-color="#d9bf93" />
          </radialGradient>
          <clipPath id="ko-moon">
            <circle cx="450" cy="104" r="64" />
          </clipPath>
        </defs>
        <rect width={VW} height="250" fill="url(#ko-warm)" />
        <g stroke="#9c7a54" stroke-width="2.4" fill="none">
          <For each={[60, 140, 220, 300, 600, 680, 760, 840]}>{(x) => <path d={`M${x} 20 V244`} />}</For>
          <For each={[60, 110, 160, 210]}>{(y) => <path d={`M40 ${y} H360 M540 ${y} H880`} />}</For>
        </g>
        <rect x="0" y="14" width={VW} height="10" fill="#7d5c3e" />
        <rect x="0" y="240" width={VW} height="12" fill="#7d5c3e" />
        <g clip-path="url(#ko-moon)">
          <rect x="380" y="36" width="140" height="140" fill="#1d2a44" />
          <circle cx="478" cy="76" r="12" fill="#f3e6c2" />
          <path d="M386 150 C420 136 470 146 520 134 V176 H386Z" fill="#e9eef3" />
        </g>
        <circle cx="450" cy="104" r="64" fill="none" stroke="#7d5c3e" stroke-width="9" />
        <rect y="252" width={VW} height="108" fill="#c7bf8e" />
        <path d="M0 300 H900 M300 252 V360 M600 252 V360" stroke="#53603f" stroke-width="3" />
      </Layer>
      <Snow box={{ x: 386, y: 40, w: 128, h: 128 }} density={6} round />
      <For each={[["yuki", 450, 200, 84], ["lavender", 206, 318, 78], ["yuzu", 694, 318, 78]] as const}>
        {([slug, x, base, size], i) => <Sitter slug={slug} x={x} base={base} size={size} ref={(el) => (birds[i()] = el)} />}
      </For>
      <Layer z={3}>
        {/* The table top, the quilt over everyone's laps, mikan, and tea. */}
        <path d="M300 214 L600 214 L640 236 L260 236Z" fill="#8a6646" stroke="#2b2824" stroke-width="1.4" />
        <path d="M244 238 C300 228 600 228 656 238 L690 312 C600 336 300 336 210 312Z" fill="#2f416a" stroke="#2b2824" stroke-width="1.4" />
        <path d="M262 258 L300 288 L338 258 L376 288 L414 258 L452 288 L490 258 L528 288 L566 258 L604 288 L642 258" stroke="#8fa3c8" stroke-opacity=".5" stroke-width="1.4" fill="none" />
        <path d="M232 296 C320 314 580 314 668 296" stroke="#c74c3c" stroke-width="5" fill="none" stroke-linecap="round" />
        <ellipse cx="420" cy="214" rx="34" ry="8" fill="#b58a5a" stroke="#2b2824" stroke-width="1.2" />
        <For each={[[404, 205], [422, 203], [440, 206], [414, 196], [432, 195]] as const}>
          {([x, y]) => <circle cx={x} cy={y} r="8" fill="#f19a3e" stroke="#2b2824" stroke-width="1.1" />}
        </For>
        <path d="M430 188 q4 -5 9 -3" stroke="#6e8a58" stroke-width="2" fill="none" />
        <path d="M504 200 L506 216 H520 L522 200Z" fill="#e9e1d1" stroke="#2b2824" stroke-width="1.2" />
        <g class="scene-steam" stroke="#fffaf0">
          <path d="M510 196 c-4 -6 4 -10 0 -16 c-4 -6 4 -10 0 -16" />
          <path d="M516 196 c-4 -6 4 -10 0 -16 c-4 -6 4 -10 0 -16" style={{ "animation-delay": "1.5s" }} />
        </g>
      </Layer>
    </Stage>
  )
}

// ----- 4. Snow lantern garden ------------------------------------------------------------

function Garden() {
  const birds: HTMLSpanElement[] = []
  onMount(() => onCleanup(animate(birds, { leans: [0, 1] })))
  return (
    <Stage class="garden">
      <Layer>
        <defs>
          <linearGradient id="ga-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#151a30" />
            <stop offset="1" stop-color="#2d3352" />
          </linearGradient>
          <radialGradient id="ga-lamp">
            <stop offset="0" stop-color="#f6c66e" stop-opacity=".6" />
            <stop offset="1" stop-color="#f6c66e" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width={VW} height={VH} fill="url(#ga-sky)" />
        <circle cx="160" cy="70" r="20" fill="#f3e6c2" />
        <path d="M560 214 C620 160 720 160 780 214" stroke="#c3402e" stroke-width="9" fill="none" />
        <path d="M566 196 C624 150 716 150 774 196" stroke="#c3402e" stroke-width="4" fill="none" />
        <path d="M566 192 C624 146 716 146 774 192" stroke="#eef2f3" stroke-width="3" fill="none" />
        <For each={[590, 630, 670, 710, 750]}>{(x) => <path d={`M${x} ${x < 670 ? 180 - (x - 590) * 0.4 : 164 + (x - 670) * 0.4} V${210}`} stroke="#c3402e" stroke-width="3" />}</For>
        <path d="M900 30 C820 40 760 60 700 100 M780 52 C770 30 776 18 790 10" stroke="#2a2328" stroke-width="5" fill="none" stroke-linecap="round" />
        <path d="M900 26 C820 36 760 56 700 96" stroke="#eef2f3" stroke-width="3" fill="none" />
        <For each={[[760, 66], [728, 82], [806, 46], [790, 20], [846, 38]] as const}>
          {([x, y]) => (
            <g transform={`translate(${x} ${y})`}>
              <For each={[0, 72, 144, 216, 288]}>{(a) => <circle cy="-3.4" r="3.2" transform={`rotate(${a})`} fill="#ee8fa2" />}</For>
              <circle r="1.6" fill="#f6d27a" />
            </g>
          )}
        </For>
        <path d="M0 236 C260 226 640 230 900 222 V360 H0Z" fill="#e9e3d6" />
        <g stroke="#2b2824" stroke-opacity=".18" fill="none" stroke-width="1.4">
          <For each={[0, 1, 2, 3, 4]}>{(i) => <ellipse cx="640" cy="300" rx={44 + i * 22} ry={12 + i * 7} />}</For>
          <For each={[256, 272, 288, 320, 336]}>{(y) => <path d={`M0 ${y} C200 ${y - 6} 420 ${y + 4} 560 ${y - 2}`} />}</For>
        </g>
        <path d="M612 302 C618 284 664 282 672 300 C660 312 624 312 612 302Z" fill="#5d5f63" />
        <path d="M618 288 q20 -8 46 0" stroke="#f6f3ec" stroke-width="5" stroke-linecap="round" fill="none" />
        <circle cx="330" cy="196" r="110" fill="url(#ga-lamp)" class="scene-flicker" />
        <path d="M300 300 L312 248 M360 300 L348 248 M330 304 V250" stroke="#6b6f70" stroke-width="7" stroke-linecap="round" />
        <rect x="300" y="236" width="60" height="14" rx="3" fill="#7a7f80" />
        <rect x="310" y="192" width="40" height="44" rx="3" fill="#7a7f80" />
        <rect x="318" y="200" width="24" height="28" fill="#f6c66e" class="scene-flicker" />
        <path d="M262 196 C290 176 370 176 398 196 L330 162Z" fill="#6b6f70" />
        <path d="M268 190 C296 172 364 172 392 190 C380 176 350 164 330 162 C310 164 280 176 268 190Z" fill="#f6f3ec" />
      </Layer>
      <Snow density={1.3} />
      <For each={[["yuki", 330, 166, 70], ["earlgrey", 642, 290, 60]] as const}>
        {([slug, x, base, size], i) => <Sitter slug={slug} x={x} base={base} size={size} ref={(el) => (birds[i()] = el)} />}
      </For>
    </Stage>
  )
}

const OPTIONS = [
  { jp: "浮世絵の夜雪", name: "Ukiyo-e night snow", vibe: "Hiroshige's woodblock night: indigo fading to a pale horizon, flat snow, Mt. Yōtei, a sumi branch heavy with snow, and the birds pressed together on it like dango. A vermilion 雪 seal.", scene: Ukiyoe, chips: ["#14203a", "#2b4670", "#efe9dc", "#1c1a20", "#c3402e"] },
  { jp: "雪見の露天風呂", name: "Onsen", vibe: "A little outdoor hot spring at night: the birds soak up to their bellies, Yuki wears a folded towel on its head, yuzu bob, a sake tray drifts, steam rises against a bamboo fence and a lantern.", scene: Onsen, chips: ["#0f1b20", "#3f8b88", "#8c7f52", "#f2c14e", "#f6c66e"] },
  { jp: "こたつ", name: "Kotatsu", vibe: "A tatami room with warm shoji and a round moon window full of snow. The birds are tucked under the kotatsu quilt, only their heads out, around a basket of mikan and a steaming cup.", scene: Kotatsu, chips: ["#f7e4bf", "#7d5c3e", "#2f416a", "#c7bf8e", "#f19a3e"] },
  { jp: "雪見灯籠", name: "Snow lantern garden", vibe: "A night Zen garden: raked sand, a snow-capped stone lantern glowing amber with Yuki on its roof, a vermilion bridge, and a plum branch in blossom under the moon.", scene: Garden, chips: ["#151a30", "#e9e3d6", "#c3402e", "#ee8fa2", "#f6c66e"] },
]

function Page() {
  return (
    <main class="scenes-page">
      <header>
        <h1>The empty chat, four ways</h1>
        <p>Each is a slice of a Japanese winter around the Shima Enaga, live, with the real birds. The heading and composer sit under the scene in the app.</p>
      </header>
      <For each={OPTIONS}>
        {(o, i) => (
          <section class="scenes-option">
            <div class="scenes-label">
              <span class="scenes-num">{i() + 1}</span>
              <div>
                <h2>
                  {o.name} <span>{o.jp}</span>
                </h2>
                <p>{o.vibe}</p>
              </div>
              <div class="scenes-chips">
                <For each={o.chips}>{(c) => <span style={{ background: c }} />}</For>
              </div>
            </div>
            <o.scene />
            <div class="scenes-composer">
              <strong>What's on your mind?</strong>
              <div>Message Yuki</div>
            </div>
          </section>
        )}
      </For>
    </main>
  )
}

render(() => <Page />, document.getElementById("root")!)
