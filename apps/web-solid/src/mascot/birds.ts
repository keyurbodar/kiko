// The flock, drawn in sumi ink. Every bird is a Shima Enaga in one of two shapes: the mochi, a
// wide soft dome facing you, for every agent; and the loaf, the bird in profile with its long tail
// held out, for Yuki's own mark. A bird is data (flavor, outfit) and a pure function turns it into
// SVG, so the avatar, the typing row, the favicon and the picker all draw the same thing.
//
// The bird never acts. Its mood shows only in its eyes, and a working bird's ink line boils: the
// outline redraws a little differently a few times a second, like a sketch being traced.

export type BirdState = "idle" | "thinking" | "working" | "typing" | "sending" | "wave" | "sleeping"
export type BirdShape = "mochi" | "loaf"

type Flavor = {
  label: string
  vibe: string
  body: string
  /** The crown's color, cut in a few scallops across the top of the head. */
  top?: string
  belly: string
  nub: string
  tail: string
  beak?: string
  eye?: string
  blush?: string
  /** Sesame dots on the crown. */
  speck?: string
  /** Freckles on the cheeks. */
  freckle?: string
  /** Chroma and hue of the readable ink for names and mentions. `null` is the theme accent. */
  ink: readonly [chroma: number, hue: number] | null
}

export const FLAVORS = {
  yuki: { label: "Yuki", vibe: "warm cream", body: "#F6EDE0", belly: "#F2D8C6", nub: "#B6A28E", tail: "#9C8C7E", ink: null },
  matcha: { label: "Matcha", vibe: "whisked green tea", body: "#DDE0BE", top: "#ADB67C", belly: "#F2ECD8", nub: "#949C68", tail: "#868D5E", ink: [0.09, 115] },
  sakura: { label: "Sakura", vibe: "blossom milk", body: "#F4DEDE", top: "#EBB2B8", belly: "#FBEFEA", nub: "#D2989E", tail: "#BE8A90", blush: "#EE8088", beak: "#8A5E62", ink: [0.1, 5] },
  hojicha: { label: "Hojicha", vibe: "roasted tea", body: "#E9D8C4", top: "#BE966F", belly: "#F2E2D0", nub: "#9C7856", tail: "#8C6A4C", ink: [0.08, 60] },
  lavender: { label: "Lavender", vibe: "lavender haze", body: "#E6DEEE", top: "#BAA8D4", belly: "#F4ECF2", nub: "#9C8CB2", tail: "#8E80A4", freckle: "#9A6E84", ink: [0.09, 300] },
  ramune: { label: "Ramune", vibe: "soda pop", body: "#DCE8F0", top: "#A6C6DC", belly: "#F4F8FA", nub: "#86A8C0", tail: "#7A9AB2", blush: "#F09C9C", ink: [0.09, 235] },
  peach: { label: "Peach", vibe: "white peach", body: "#F6DECE", top: "#EEB492", belly: "#FCEEE2", nub: "#D49A7C", tail: "#C0886C", blush: "#EE887E", ink: [0.11, 45] },
  yuzu: { label: "Yuzu", vibe: "citrus honey", body: "#F4EAC6", top: "#E8C670", belly: "#FBF2DC", nub: "#CAAC64", tail: "#B89C58", ink: [0.11, 90] },
  sesame: { label: "Sesame", vibe: "black sesame", body: "#E2DDD6", top: "#A8A098", belly: "#F0EBE4", nub: "#827A74", tail: "#706A66", speck: "#3E3834", ink: [0.02, 60] },
  earlgrey: { label: "Earl Grey", vibe: "milk tea", body: "#DADDE2", top: "#9CA4B4", belly: "#EEE8DE", nub: "#848C9C", tail: "#788090", blush: "#E49C94", ink: [0.04, 260] },
  mintchoco: { label: "Mint Choco", vibe: "mint chip", body: "#D4EADE", top: "#9CCEB6", belly: "#EEF6F0", nub: "#6E5446", tail: "#5E463A", speck: "#5E463A", ink: [0.08, 165] },
  ichigo: { label: "Ichigo", vibe: "strawberry daifuku", body: "#F6EDE6", top: "#E68E98", belly: "#FBF2EC", nub: "#D8989C", tail: "#C4888E", freckle: "#D8707C", blush: "#EE8088", ink: [0.12, 10] },
  kinako: { label: "Kinako", vibe: "midnight dango", body: "#41455C", top: "#2C3046", belly: "#D8BE86", nub: "#2C3046", tail: "#262A3C", eye: "#101018", beak: "#D8BE86", blush: "#E08E8E", speck: "#F0DAA0", ink: [0.08, 275] },
} as const satisfies Record<string, Flavor>

export type FlavorId = keyof typeof FLAVORS
export const FLAVOR_IDS = Object.keys(FLAVORS) as FlavorId[]
/** Every flavor but Yuki's own cream: the colors another agent can wear. */
export const FRIEND_IDS = FLAVOR_IDS.filter((f) => f !== "yuki")

const flower = (x: number, y: number, petal: string, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})" stroke-width="1">${[0, 72, 144, 216, 288].map((a) => `<circle cx="0" cy="-3" r="2.8" transform="rotate(${a})" fill="${petal}"/>`).join("")}<circle r="1.6" fill="#F2D27A"/></g>`

/** What a mochi can wear, drawn on its crown in the same ink. Muted fabrics, so the bird stays the hero. */
export const OUTFITS = {
  none: { label: "Nothing", svg: "" },
  beanie: { label: "Knit beanie", svg: `<path d="M38 60 C38 44 48 36 60 36 C72 36 82 44 82 60Z" fill="#D9A3A0"/><path d="M47 57 C47 49 49 43 52 40 M60 57 V38 M73 57 C73 49 71 43 68 40" fill="none" stroke-width="1" stroke-opacity=".5"/><rect x="35" y="56" width="50" height="8" rx="4" fill="#C99390"/><circle cx="60" cy="33" r="5" fill="#F5E8E2"/>` },
  beret: { label: "Beret", svg: `<path d="M57 44 L58.4 40" fill="none"/><ellipse cx="57" cy="51" rx="24" ry="7.4" transform="rotate(-10 57 51)" fill="#6B7C9C"/>` },
  bucket: { label: "Bucket hat", svg: `<ellipse cx="60" cy="59" rx="30" ry="5.6" fill="#DCC797"/><path d="M42 59 C42 46 49 40 60 40 C71 40 78 46 78 59Z" fill="#E8D6A8"/><path d="M43 55 C52 57 68 57 77 55" fill="none" stroke-width="1" stroke-dasharray="2 2"/>` },
  phones: { label: "Headphones", svg: `<path d="M23 82 C21 44 99 44 97 82" fill="none" stroke="#7E9282" stroke-width="4.4"/><ellipse cx="22.5" cy="84" rx="6" ry="9" fill="#9CB0A0"/><ellipse cx="97.5" cy="84" rx="6" ry="9" fill="#8AA090"/>` },
  crown: { label: "Flower crown", svg: `<path d="M38 56 C48 50 72 50 82 56" fill="none" stroke="#9DB87A" stroke-width="2.4"/>${flower(41, 55, "#F6C6CE")}${flower(51, 51, "#FBF7EE", 0.85)}${flower(60, 49.5, "#D8C6EA")}${flower(69, 51, "#FBF7EE", 0.85)}${flower(79, 55, "#F6C6CE")}` },
  bow: { label: "Ribbon bow", svg: `<g transform="translate(79 54) rotate(14)"><path d="M0 0 C-6 -8 -15 -6 -14 1 C-13 7 -6 6 0 0Z M0 0 C6 -8 15 -6 14 1 C13 7 6 6 0 0Z" fill="#F2A7B4"/><circle r="2.8" fill="#E894A3"/></g>` },
  nightcap: { label: "Nightcap", svg: `<path d="M40 60 C41 45 55 37 69 38 C83 39 94 49 99 64 C100 69 96 71 94 67 C90 57 84 52 81 60Z" fill="#B8CCE4"/><rect x="37" y="56" width="46" height="7.4" rx="3.7" fill="#F6F2E8"/><circle cx="97" cy="70" r="4.6" fill="#F6F2E8"/>` },
  leaf: { label: "Leaf umbrella", svg: `<path d="M90 98 C92 76 86 56 74 42" fill="none" stroke="#6E8A58" stroke-width="2.2"/><path d="M28 46 C40 28 82 22 99 40 C82 43 52 47 28 46Z" fill="#9DB87A"/><path d="M48 44 L52 34 M64 42 L68 30 M80 41 L86 31" fill="none" stroke-width="1" stroke-opacity=".5"/>` },
  snowcap: { label: "First snow", svg: `<path d="M41 57 C42 48 52 44.5 59 46 C67 44.5 78 48.5 79 57 C72 54.6 65 55.6 59.5 54.6 C53 55.8 47 57.6 41 57Z" fill="#FFFFFF"/>` },
  blossom: { label: "Sakura", svg: `<g transform="translate(78 53) rotate(12)">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-4.4" rx="3.2" ry="4.4" transform="rotate(${a})" fill="#F7C4CF"/>`).join("")}<circle r="1.8" fill="#E58FA3"/></g>` },
  momiji: { label: "Momiji", svg: `<g transform="translate(78 52) rotate(-16)"><path d="M0 4 L0 10" fill="none"/><path d="M0 -7.5 L1.8 -3 L5.6 -5 L4 -1 L7.6 0.4 L3.6 2 L4.6 5.4 L0.8 3.6 L0 6 L-0.8 3.6 L-4.6 5.4 L-3.6 2 L-7.6 0.4 L-4 -1 L-5.6 -5 L-1.8 -3Z" fill="#E0784C"/></g>` },
} as const satisfies Record<string, { label: string; svg: string }>

export type OutfitId = keyof typeof OUTFITS
export const OUTFIT_IDS = Object.keys(OUTFITS) as OutfitId[]

export type BirdSpec = { flavor: FlavorId; outfit: OutfitId }

/** The chief. Its flavor never changes; only what it wears does. */
export const YUKI_BIRD: BirdSpec = { flavor: "yuki", outfit: "none" }

// --- ids ---------------------------------------------------------------------------

export const formatBird = (b: BirdSpec) => `${b.flavor}.${b.outfit}`

/** A stored pick. Anything else, including an outfit the flock no longer has, reads as null. */
export function parseBird(id: string): BirdSpec | null {
  const parts = id.split(".")
  if (parts.length !== 2) return null
  const [flavor, outfit] = parts as [string, string]
  if (!(flavor in FLAVORS) || !(outfit in OUTFITS)) return null
  return { flavor: flavor as FlavorId, outfit: outfit as OutfitId }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const SEED_OUTFITS: OutfitId[] = ["beanie", "beret", "bucket", "phones", "crown", "bow"]

/** The bird a slug wears when nobody picked one. The chief is always Yuki. About a third of the others wear something. */
export function seedBird(slug: string, chief: string): BirdSpec {
  if (slug === chief) return YUKI_BIRD
  const h = hash(slug)
  const flavor = FRIEND_IDS[h % FRIEND_IDS.length]!
  const outfit = (h >>> 16) % 3 === 0 ? SEED_OUTFITS[(h >>> 20) % SEED_OUTFITS.length]! : "none"
  return { flavor, outfit }
}

// --- color -------------------------------------------------------------------------

/** The color an agent's name and mentions use, readable on both appearances. Yuki uses the theme's accent. */
export function inkColor(b: BirdSpec): string {
  const ink: Flavor["ink"] = FLAVORS[b.flavor].ink
  if (!ink) return "var(--accent)"
  const [c, h] = ink
  const chroma = Math.max(c, 0.06)
  return `light-dark(oklch(0.5 ${chroma} ${h}), oklch(0.78 ${Math.min(chroma, 0.14)} ${h}))`
}

// --- drawing -----------------------------------------------------------------------

const INK = "#2B2824"

/** Each shape's box: square for the mochi, so it sits in any avatar slot; wide for the loaf. */
export const VIEWBOX: Record<BirdShape, readonly [x: number, y: number, w: number, h: number]> = {
  mochi: [3, 24, 103, 103],
  loaf: [2, 42, 103, 62],
}

/** A wavy crown: the color across the top of the head, in a few hand-cut scallops. */
const crown = (y: number) =>
  `M0 0 L120 0 L120 ${y} C111 ${y + 4} 103 ${y - 1} 95 ${y + 3.5} C87 ${y - 0.5} 79 ${y + 4.5} 71 ${y + 1} C63 ${y + 4.5} 55 ${y - 0.5} 47 ${y + 3.5} C39 ${y - 0.5} 30 ${y + 4} 22 ${y} C14 ${y + 3} 6 ${y - 1} 0 ${y + 2}Z`

type Eyes = "bead" | "up" | "down" | "happy" | "closed"

/** Each mood is only a look in the eyes, and whether the ink boils. */
const MOODS: Record<BirdState, { eyes: Eyes; boil?: boolean; rosy?: boolean }> = {
  idle: { eyes: "bead" },
  thinking: { eyes: "up", boil: true },
  working: { eyes: "down", boil: true },
  typing: { eyes: "down", boil: true },
  sending: { eyes: "happy" },
  wave: { eyes: "happy" },
  sleeping: { eyes: "closed", rosy: true },
}

/** A pair of bead eyes, or one in profile, at `[x, y, r]` each. */
function eyes(kind: Eyes, at: readonly (readonly [number, number, number])[], ink: string): string {
  if (kind === "happy") return `<path d="${at.map(([x, y, r]) => `M${x - r} ${y + 0.6} Q${x} ${y - r * 1.1} ${x + r} ${y + 0.6}`).join(" ")}" fill="none" stroke="${ink}" stroke-width="2"/>`
  if (kind === "closed") return `<path d="${at.map(([x, y, r]) => `M${x - r} ${y - 0.4} Q${x} ${y + r * 0.8} ${x + r} ${y - 0.4}`).join(" ")}" fill="none" stroke="${ink}" stroke-width="1.8"/>`
  const dy = kind === "up" ? -1.3 : kind === "down" ? 1 : 0
  const k = kind === "down" ? 0.88 : 1
  return `<g class="bird-eyes" stroke="none">${at.map(([x, y, r]) => `<circle cx="${x}" cy="${y + dy}" r="${r * k}" fill="${ink}"/><circle cx="${x - 1.2}" cy="${y + dy - 1.3}" r="${r * 0.36}" fill="#fff"/>`).join("")}</g>`
}

const blush = (x: number, y: number, rx: number, color: string, op: number) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${rx * 0.58}" fill="${color}" fill-opacity="${op}" stroke="none"/>`

/** The body's fill with its crown, belly, shade and specks clipped inside, then the ink outline over it. */
function body(path: string, f: Flavor, crownY: number, belly: readonly number[], shade: string, specks: readonly number[][], clip: string): string {
  return (
    `<path d="${path}" fill="${f.body}" stroke="none"/>` +
    `<g clip-path="url(#${clip})" stroke="none">` +
    (f.top ? `<path d="${crown(crownY)}" fill="${f.top}"/>` : "") +
    `<ellipse cx="${belly[0]}" cy="${belly[1]}" rx="${belly[2]}" ry="${belly[3]}" fill="${f.belly}"/>` +
    `<path d="${shade}" fill="#000" fill-opacity=".12"/>` +
    (f.speck ? `<g fill="${f.speck}" fill-opacity=".75">${specks.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1"/>`).join("")}</g>` : "") +
    `</g><path d="${path}" fill="none"/>`
  )
}

const MOCHI = "M20 90 C20 66 38 50 60 50 C82 50 100 66 100 90 C100 98 92 101 60 101 C28 101 20 98 20 90Z"
const LOAF = "M38 72 C38 55 51 45 67 45 C85 45 97 57 97 71 C97 86 85 96 67 96 C51 96 38 88 38 72Z"

function drawMochi(f: Flavor, mood: (typeof MOODS)[BirdState], b: BirdSpec, clip: string, expressive: boolean): string {
  const ink = f.eye ?? "#2B2420"
  const color = f.blush ?? "#F2A294"
  const op = mood.rosy ? 0.9 : 0.75
  return (
    `<clipPath id="${clip}"><path d="${MOCHI}"/></clipPath>` +
    `<path d="M24 92 C18 93 12 94 7 95 C5.5 95.4 5.8 98 7.4 97.8 C13 97.4 19 96.8 25 96.4Z" fill="${f.tail}"/>` +
    body(MOCHI, f, 63, [60, 97, 27, 8], "M22 86 C26 96 40 101 60 101 C42 98 30 93 26 82Z", [[42, 58], [50, 55], [60, 54], [70, 55], [78, 58], [36, 64], [84, 64]], clip) +
    `<ellipse cx="25.5" cy="87" rx="4.6" ry="7.4" transform="rotate(14 25.5 87)" fill="${f.nub}"/>` +
    `<path d="M96 80 C98 84 98 89 96 92" fill="none"/>` +
    `<path d="M34 62 C38 58 42 56 46 55" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"/>` +
    blush(41, 86, 5, color, op) +
    blush(79, 86, 5, color, op) +
    (f.freckle ? `<g fill="${f.freckle}" fill-opacity=".7" stroke="none">${[[38.5, 85.4], [41, 87.2], [43.5, 85.6], [76.5, 85.4], [79, 87.2], [81.5, 85.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".65"/>`).join("")}</g>` : "") +
    eyes(mood.eyes, [[50, 77.5, 3.6], [70, 77.5, 3.4]], ink) +
    `<path class="bird-beak" d="M57 82.5 L63 82.5 L60 86.2Z" fill="${f.beak ?? "#7A6458"}" stroke-width="1.4"/>` +
    (expressive
      ? // Faces a scene can switch to without redrawing: happy eyes, dozing eyes, and an open beak.
        `<path class="bird-happy" d="M46.4 78.2 Q50 73.8 53.6 78.2 M66.6 78.2 Q70 74 73.4 78.2" fill="none" stroke="${ink}" stroke-width="2"/>` +
        `<path class="bird-closed" d="M46.5 77 Q50 79.8 53.5 77 M66.5 77 Q70 79.6 73.5 77" fill="none" stroke="${ink}" stroke-width="1.8"/>` +
        `<g class="bird-mouth"><path d="M56.6 81.6 L63.4 81.6 L60 83.4Z" fill="${f.beak ?? "#7A6458"}" stroke-width="1.2"/><path d="M57.4 84.2 Q60 89.6 62.6 84.2Z" fill="#7A3E3A" stroke-width="1.2"/></g>`
      : "") +
    OUTFITS[b.outfit].svg
  )
}

function drawLoaf(f: Flavor, mood: (typeof MOODS)[BirdState], clip: string): string {
  const ink = f.eye ?? "#2B2420"
  return (
    `<clipPath id="${clip}"><path d="${LOAF}"/></clipPath>` +
    `<path d="M44 75 C30 73 17 70.5 5 69 C3.4 68.8 3.3 72.4 5 72.9 C17 75.6 30 79 44 83Z" fill="${f.tail}"/>` +
    `<path d="M61 95 L59.5 100.5 M64.5 95.6 L64 101 M72 95.6 L72.4 101 M75.5 95 L77 100.5" fill="none" stroke="#5E524A" stroke-width="2"/>` +
    body(LOAF, f, 55, [74, 91, 21, 9], "M40 77 C44 90 56 96 68 96 C56 92 46 86 43 73Z", [[56, 50], [64, 48], [72, 48], [80, 51]], clip) +
    `<path class="bird-wing" d="M74 66 C66 61 54 63 47 70 C44 73 42 76 41 79 C47 80 54 79.5 60 77.5 C67 75 72 71 74 66Z" fill="${f.nub}" stroke-width="1.6"/>` +
    `<path d="M52 52 C55 49 59 47.5 63 47" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"/>` +
    blush(84, 76, 4.6, f.blush ?? "#F2A294", mood.rosy ? 0.9 : 0.75) +
    eyes(mood.eyes, [[85, 65.5, 3.6]], ink) +
    `<path d="M96.5 67.7 L102.5 70.5 L96.5 73.3Z" fill="${f.beak ?? "#7A6458"}" stroke-width="1.4"/>`
  )
}

let uid = 0

/**
 * How a bird is drawn. `size` is its rendered height in px: the ink line never drops under 1 px
 * on screen, and under 24 px the line is drawn straight, since a wobble that small is a blur.
 * `flat` drops the sketch filter entirely, for the favicon. `still` keeps a working bird's line
 * from boiling, for reduced motion. `expressive` adds the faces a scene switches to on its own
 * (happy eyes, dozing eyes, an open beak), so a playing bird never redraws.
 */
export type DrawOptions = { shape?: BirdShape; size?: number; flat?: boolean; still?: boolean; expressive?: boolean }

/** The SVG markup for a bird, in its shape's box (`VIEWBOX`). Pure, so tests and scripts can call it. */
export function birdSvg(b: BirdSpec, state: BirdState = "idle", opts: DrawOptions = {}): string {
  const shape = opts.shape ?? "mochi"
  const f: Flavor = FLAVORS[b.flavor]
  const mood = MOODS[state]
  const id = `yb${uid++}`
  const h = VIEWBOX[shape][3]
  const size = opts.size ?? 32
  const sw = Math.max(2.2, h / size).toFixed(2)
  const rough = !opts.flat && size >= 24
  const boil = rough && mood.boil && !opts.still
  const filter = rough
    ? `<filter id="${id}r" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="6">${boil ? `<animate attributeName="seed" values="6;11;3;8" dur=".6s" calcMode="discrete" repeatCount="indefinite"/>` : ""}</feTurbulence><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter>`
    : ""
  const art = shape === "loaf" ? drawLoaf(f, mood, `${id}c`) : drawMochi(f, mood, b, `${id}c`, opts.expressive ?? false)
  return (
    filter +
    `<g class="bird-body"${rough ? ` filter="url(#${id}r)"` : ""} stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round">${art}</g>`
  )
}
