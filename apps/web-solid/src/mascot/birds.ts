// The flock: one round bird, many species. A bird is data (species, tint, accessory) and a
// pure function turns it into SVG, so the avatar, the typing dots, the favicon and the
// picker all draw the same thing. The kiko bird reads the theme's brand hue from CSS, so it
// follows every preset and both appearances.

export type BirdState = "idle" | "thinking" | "working" | "typing" | "sending" | "wave"

type Oklch = readonly [l: number, c: number, h: number]

type Species = {
  label: string
  /** The body. A tint turns its hue. `null` means the theme's brand colour (the kiko bird). */
  body: Oklch | null
  belly: string
  beak: string
  crest?: "tuft" | "spike" | "fan"
  /** Extra shapes clipped to the body: a cap, a mask, a face patch. */
  marks?: string
  /** A different beak outline. */
  beakPath?: string
  /** A pale ring around the eye, for dark faces. */
  ring?: boolean
}

const CREAM = "#FBF4E8"
const ORANGE = "#FFA14A"
const INK = "#221A20"

export const SPECIES = {
  kiko: { label: "Kiko", body: null, belly: "#FFE3D2", beak: ORANGE, crest: "tuft" },
  kingfisher: { label: "Kingfisher", body: [0.68, 0.14, 232], belly: "#FFB27A", beak: "#3A3340", crest: "tuft" },
  cardinal: { label: "Cardinal", body: [0.66, 0.17, 25], belly: "#FFE2D8", beak: "#FF9A4A", crest: "spike", marks: `<path d="M58 44 Q72 40 82 48 L82 58 Q70 62 58 54Z" fill="${INK}"/>`, ring: true },
  jay: { label: "Blue jay", body: [0.7, 0.13, 260], belly: CREAM, beak: "#3A3340", crest: "spike" },
  bluebird: { label: "Bluebird", body: [0.76, 0.1, 240], belly: "#FFB27A", beak: "#3A3340", crest: "tuft" },
  robin: { label: "Robin", body: [0.62, 0.02, 60], belly: "#FF8A4C", beak: "#F2B33D" },
  sparrow: { label: "Sparrow", body: [0.74, 0.06, 60], belly: CREAM, beak: "#3A3340", marks: `<path d="M10 0 H100 V40 Q70 34 50 40 Q30 46 10 38Z" fill="oklch(0.55 0.07 55)"/>` },
  chickadee: { label: "Chickadee", body: [0.82, 0.01, 260], belly: CREAM, beak: "#3A3340", marks: `<path d="M10 0 H100 V42 Q80 36 62 42 Q40 48 10 40Z" fill="#2E2C34"/><ellipse cx="62" cy="55" rx="15" ry="7" fill="${CREAM}"/>` },
  canary: { label: "Canary", body: [0.86, 0.15, 95], belly: "#FFF4C2", beak: ORANGE, crest: "tuft" },
  lovebird: { label: "Lovebird", body: [0.82, 0.14, 145], belly: "#E9FBE3", beak: "#FF7A6B", marks: `<circle cx="66" cy="50" r="15" fill="#FFAE8A"/>`, ring: true },
  parrot: { label: "Parrot", body: [0.74, 0.17, 150], belly: "#E6F7D9", beak: "#FFB627", marks: `<path d="M22 60 Q31 48 46 57 Q37 71 22 60Z" fill="#4A86EA"/>`, beakPath: "M77 44 Q94 44 92 60 Q87 53 77 58Z", ring: true },
  flamingo: { label: "Flamingo", body: [0.8, 0.11, 355], belly: "#FFE1EA", beak: "#2A2024", beakPath: "M77 46 Q88 46 90 52 Q90 58 86 59 L84 55 Q82 53 77 57Z" },
  cockatoo: { label: "Cockatoo", body: [0.96, 0.01, 85], belly: "#FFFFFF", beak: "#4A4450", crest: "fan", beakPath: "M77 45 Q91 45 89 59 Q85 53 77 57Z" },
  mallard: { label: "Mallard", body: [0.78, 0.04, 70], belly: "#EFE5D4", beak: "#F5C518", marks: `<rect width="100" height="49" fill="#3A9A62"/><rect y="49" width="100" height="3.4" fill="${CREAM}"/>`, beakPath: "M77 47 Q94 46 94 53 Q94 59 77 59Z", ring: true },
  puffin: { label: "Puffin", body: [0.3, 0.01, 280], belly: CREAM, beak: "#FF6A3D", marks: `<ellipse cx="65" cy="50" rx="15" ry="13" fill="${CREAM}"/>`, beakPath: "M77 43 Q93 49 93 53 Q93 57 77 62Z" },
  toucan: { label: "Toucan", body: [0.27, 0.01, 280], belly: CREAM, beak: "#FFB627", marks: `<ellipse cx="68" cy="62" rx="11" ry="12" fill="${CREAM}"/>`, beakPath: "M75 42 C92 36 101 46 98 52 C95 58 86 61 75 59Z", ring: true },
  penguin: { label: "Penguin", body: [0.38, 0.06, 265], belly: CREAM, beak: ORANGE, ring: true },
} as const satisfies Record<string, Species>

export type SpeciesId = keyof typeof SPECIES
export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[]

/** Hue turns for the body. Tint 0 is the bird as nature made it. */
export const TINTS = [0, 40, -45, 160] as const

/** Things a bird can wear. Positions are in the bird's 100-unit box, facing right. */
export const ACCESSORIES = {
  none: { label: "Nothing", svg: "" },
  leaf: { label: "Sprout", svg: `<path d="M49 24 v-7" stroke="#5FB04F" stroke-width="3" stroke-linecap="round"/><ellipse cx="43" cy="14" rx="7" ry="3.8" transform="rotate(-30 43 14)" fill="#7DCB68"/><ellipse cx="55" cy="14" rx="7" ry="3.8" transform="rotate(30 55 14)" fill="#7DCB68"/>` },
  bow: { label: "Bow", svg: `<path d="M58 28 l-9 -6 q-2 6 0 12z M58 28 l9 -6 q2 6 0 12z" fill="#FF6F91" stroke="#FF6F91" stroke-width="3" stroke-linejoin="round"/><circle cx="58" cy="28" r="3.4" fill="#FF8FAA"/>` },
  flower: { label: "Flower", svg: `<g transform="translate(36 26)">${[0, 72, 144, 216, 288].map((a) => `<circle cx="0" cy="-5" r="4" transform="rotate(${a})" fill="#fff"/>`).join("")}<circle r="3.4" fill="#FFC93C"/></g>` },
  cap: { label: "Cap", svg: `<path d="M24 40 Q26 22 48 22 Q68 22 72 38 Z" fill="#E5484D"/><path d="M66 36 Q80 34 88 40 Q78 42 68 41Z" fill="#B92F35"/><circle cx="48" cy="22" r="2.4" fill="#B92F35"/>` },
  beanie: { label: "Beanie", svg: `<path d="M22 42 Q22 18 48 18 Q74 18 74 42 Z" fill="#4C7BD9"/><rect x="21" y="37" width="54" height="8" rx="4" fill="#3A64BE"/><circle cx="48" cy="15" r="6" fill="#FBF4E8"/>` },
  party: { label: "Party hat", svg: `<path d="M38 30 L50 4 L62 30 Z" fill="#B98CF5"/><path d="M41 23 L59 23 M44 16 L56 16" stroke="#FFD84D" stroke-width="2.6"/><circle cx="50" cy="4" r="3.6" fill="#FFD84D"/>` },
  crown: { label: "Crown", svg: `<path d="M36 28 L35 16 L42 22 L48 12 L54 22 L61 16 L60 28 Z" fill="#FFD84D" stroke="#FFD84D" stroke-width="2.4" stroke-linejoin="round"/><circle cx="48" cy="24" r="2" fill="#E5484D"/>` },
  headphones: { label: "Headphones", svg: `<path d="M24 50 Q24 20 52 22 Q76 24 74 46" stroke="#2E2C34" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="18" y="44" width="12" height="16" rx="6" fill="#2E2C34"/><rect x="20" y="47" width="6" height="10" rx="3" fill="#FF6F91"/>` },
  glasses: { label: "Glasses", svg: `<circle cx="63" cy="52" r="8.5" fill="#fff" fill-opacity=".18" stroke="#2E2C34" stroke-width="2.6"/><path d="M71 50 L78 48 M55 51 L40 47" stroke="#2E2C34" stroke-width="2.6" stroke-linecap="round"/>` },
  scarf: { label: "Scarf", svg: `<path d="M24 72 Q48 82 74 72 L74 79 Q48 89 24 79Z" fill="#E5484D"/><path d="M30 78 L26 92 L34 92 L36 80Z" fill="#C93A40"/>` },
  bandana: { label: "Bandana", svg: `<path d="M22 40 Q48 28 74 40 L72 45 Q48 34 24 45Z" fill="#2E8B57"/><path d="M24 43 L14 38 L16 47Z" fill="#2E8B57"/>` },
} as const

export type AccessoryId = keyof typeof ACCESSORIES
export const ACCESSORY_IDS = Object.keys(ACCESSORIES) as AccessoryId[]

export type BirdSpec = { species: SpeciesId; tint: number; accessory: AccessoryId }

// --- ids ---------------------------------------------------------------------------

export const formatBird = (b: BirdSpec) => `${b.species}.${b.tint}.${b.accessory}`

export function parseBird(id: string): BirdSpec | null {
  const [species, tint, accessory] = id.split(".")
  if (!species || !(species in SPECIES)) return null
  const t = Number(tint)
  if (!Number.isInteger(t) || t < 0 || t >= TINTS.length) return null
  if (!accessory || !(accessory in ACCESSORIES)) return null
  return { species: species as SpeciesId, tint: t, accessory: accessory as AccessoryId }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const SEEDABLE = SPECIES_IDS.filter((s) => s !== "kiko")
const SEED_ACCESSORIES: AccessoryId[] = ["leaf", "bow", "flower", "cap", "beanie", "headphones", "glasses", "scarf"]

/**
 * The bird a slug wears when nobody picked one. The kiko agent is always the kiko bird.
 * Most birds are plain; about a third wear something, so the flock reads as a family.
 */
export function seedBird(slug: string): BirdSpec {
  if (slug === "kiko") return { species: "kiko", tint: 0, accessory: "none" }
  const h = hash(slug)
  const species = SEEDABLE[h % SEEDABLE.length]!
  const tint = (h >>> 8) % 5 < 3 ? 0 : 1 + ((h >>> 12) % (TINTS.length - 1))
  const accessory = (h >>> 16) % 3 === 0 ? SEED_ACCESSORIES[(h >>> 20) % SEED_ACCESSORIES.length]! : "none"
  return { species, tint, accessory }
}

// --- colour ------------------------------------------------------------------------

const css = ([l, c, h]: Oklch) => `oklch(${l} ${c} ${((h % 360) + 360) % 360})`

/** The body colour, as CSS. The kiko bird follows the theme through `--h-brand` and `--cm`. */
export function bodyColor(b: BirdSpec, shade = 0): string {
  const s: Species = SPECIES[b.species]
  if (!s.body) return `oklch(${+(0.8 - shade).toFixed(3)} calc(0.095 * var(--cm, 1)) calc(var(--h-brand, 340) + ${TINTS[b.tint]}))`
  return css([+(s.body[0] - shade).toFixed(3), s.body[1], s.body[2] + TINTS[b.tint]!])
}

/**
 * The colour an agent's name and mentions use: its body colour, kept readable on both
 * appearances with `light-dark`. The kiko bird uses the theme's accent.
 */
export function inkColor(b: BirdSpec): string {
  const s: Species = SPECIES[b.species]
  if (!s.body) return "var(--accent)"
  const [, c, h] = s.body
  const hue = h + TINTS[b.tint]!
  const chroma = Math.max(c, 0.06)
  return `light-dark(${css([0.5, chroma, hue])}, ${css([0.78, Math.min(chroma, 0.14), hue])})`
}

// --- drawing -----------------------------------------------------------------------

let uid = 0

const CRESTS = {
  tuft: (f: string) => `<ellipse cx="45" cy="25" rx="3.6" ry="7.5" transform="rotate(-24 47 31)" style="fill:${f}"/><ellipse cx="50" cy="24" rx="3.6" ry="7.5" transform="rotate(14 50 31)" style="fill:${f}"/>`,
  spike: (f: string) => `<path d="M36 32 C30 16 38 8 46 15 C45 20 47 26 52 29Z" style="fill:${f};stroke:${f}" stroke-width="3" stroke-linejoin="round"/>`,
  fan: () => [[-38, 40], [-18, 44], [2, 48]].map(([r, x]) => `<ellipse cx="${x}" cy="17" rx="4.2" ry="11" transform="rotate(${r} ${x} 27)" fill="#FFD43B"/>`).join(""),
}

/** One eye per expression. The bird looks right; its eye sits at (63, 52). */
function eye(state: BirdState, ring: boolean): string {
  const r = ring ? `<circle cx="63" cy="52" r="7.4" fill="${CREAM}"/>` : ""
  if (state === "wave" || state === "sending")
    return `${r}<path d="M58.6 53.4 Q63 47.6 67.4 53.4" stroke="${INK}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`
  const dy = state === "thinking" || state === "working" ? -2.4 : 0
  const ry = state === "typing" ? 4.2 : 5.4
  return `${r}<ellipse class="bird-eye" cx="63" cy="${52 + dy}" rx="4.4" ry="${ry}" fill="${INK}"/><circle cx="64.5" cy="${50 + dy}" r="1.7" fill="#fff"/><circle cx="61.8" cy="${54.2 + dy}" r=".8" fill="#fff"/>`
}

/** What a busy bird holds or shows. Drawn outside the bird's body group so it stays still. */
const PROPS: Partial<Record<BirdState, string>> = {
  thinking: `<g class="bird-think"><circle cx="78" cy="22" r="3" fill="var(--text-muted, #999)"/><circle cx="85" cy="14" r="4" fill="var(--text-muted, #999)"/><circle cx="94" cy="6" r="5" fill="var(--text-muted, #999)"/></g>`,
  working: `<g class="bird-gear" style="transform-origin:86px 16px"><circle cx="86" cy="16" r="7" fill="none" stroke="var(--text-muted, #999)" stroke-width="4" stroke-dasharray="3.2 2.3"/><circle cx="86" cy="16" r="2.4" fill="var(--text-muted, #999)"/></g>`,
  typing: `<g class="bird-laptop"><path d="M70 74 L96 74 L92 88 L66 88Z" fill="#3A3840"/><rect x="62" y="88" width="36" height="4" rx="2" fill="#55525C"/><circle cx="81" cy="81" r="2" fill="#FBF4E8" opacity=".8"/></g>`,
  sending: `<g class="bird-plane"><path d="M76 20 L98 10 L90 30 L86 23Z" fill="var(--accent, #c8a)"/><path d="M86 23 L98 10" stroke="#fff" stroke-width="1" opacity=".6"/></g>`,
}

/** The SVG markup for a bird, in a 100-unit box. Pure, so tests and scripts can call it. */
export function birdSvg(b: BirdSpec, state: BirdState = "idle"): string {
  const s: Species = SPECIES[b.species]
  const id = `bird-${uid++}`
  const f = bodyColor(b)
  const shade = bodyColor(b, 0.08)
  const feet = s.beak === "#3A3340" || s.beak === "#2A2024" || s.beak === "#4A4450" ? ORANGE : s.beak
  const crest = s.crest ? CRESTS[s.crest](f) : ""
  return (
    `<defs><clipPath id="${id}"><ellipse cx="48" cy="57" rx="32" ry="30"/></clipPath></defs>` +
    `<g class="bird-feet"><ellipse cx="40" cy="87.5" rx="5" ry="3" fill="${feet}"/><ellipse cx="54" cy="87.5" rx="5" ry="3" fill="${feet}"/></g>` +
    `<g class="bird-body">${crest}<ellipse cx="48" cy="57" rx="32" ry="30" style="fill:${f}"/>` +
    `<g clip-path="url(#${id})"><ellipse cx="62" cy="76" rx="20" ry="15" fill="${s.belly}"/>` +
    `<path class="bird-wing" d="M22 60 Q31 48 46 57 Q37 71 22 60Z" style="fill:${shade}"/>${s.marks ?? ""}` +
    `<ellipse cx="34" cy="40" rx="6" ry="3.6" transform="rotate(-30 34 40)" fill="#fff" opacity=".32"/></g>` +
    `<path d="${s.beakPath ?? "M77 47 Q90 50.5 90 53 Q90 55.5 77 59Z"}" fill="${s.beak}" stroke="${s.beak}" stroke-width="3" stroke-linejoin="round"/>` +
    eye(state, s.ring ?? false) +
    `<ellipse cx="64" cy="63" rx="5" ry="2.8" fill="#FF7C99" opacity=".45"/>` +
    ACCESSORIES[b.accessory].svg +
    `</g>` +
    (PROPS[state] ?? "")
  )
}
