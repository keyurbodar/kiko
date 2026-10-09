// The flock: one Shima Enaga, many flavors. Every bird shares the same cream fluffball shape
// (a bumpy crown, close-set bead eyes, a short beak, taupe nubs and a long thin tail). A bird
// is data (flavor, outfit) and a pure function turns it into SVG, so the avatar, the typing
// row, the favicon, the scenes and the picker all draw the same thing. Yuki, the chief, is the
// warm cream bird; the friends are colorways named after Japanese sweets and drinks.

export type BirdState = "idle" | "thinking" | "working" | "typing" | "sending" | "wave" | "sleeping"

type Flavor = {
  label: string
  vibe: string
  body: string
  /** The crown's color fade and how strong it is. */
  top?: readonly [color: string, opacity: number]
  belly: string
  nub: string
  tail: string
  beak?: string
  eye?: string
  feet?: string
  blush?: string
  /** Sesame specks on the crown. */
  speck?: string
  /** Freckles on the cheeks. */
  freckle?: string
  /** Two small sparkles by the crown. */
  sparkle?: string
  /** Chroma and hue of the readable ink for names and mentions. `null` is the theme accent. */
  ink: readonly [chroma: number, hue: number] | null
}

export const FLAVORS = {
  yuki: { label: "Yuki", vibe: "warm cream", body: "#FBF2E6", belly: "#F6DCCB", nub: "#BCA996", tail: "#A8988A", ink: null },
  matcha: { label: "Matcha", vibe: "whisked green tea", body: "#E4E6C8", top: ["#B9C28A", 0.75], belly: "#F7F1E0", nub: "#A4AC78", tail: "#959C6C", blush: "#F2A99A", ink: [0.09, 115] },
  sakura: { label: "Sakura", vibe: "blossom milk", body: "#F8E6E6", top: ["#F2C2C8", 0.8], belly: "#FFF6F2", nub: "#DDA8AE", tail: "#C99AA0", blush: "#F28C94", beak: "#8A5E62", ink: [0.1, 5] },
  hojicha: { label: "Hojicha", vibe: "roasted tea", body: "#EFE0CE", top: ["#C9A27E", 0.7], belly: "#F7EADB", nub: "#A88462", tail: "#987658", ink: [0.08, 60] },
  lavender: { label: "Lavender", vibe: "lavender haze", body: "#ECE6F2", top: ["#C8B8E0", 0.75], belly: "#F8F2F6", nub: "#A898BE", tail: "#9A8CB0", freckle: "#A97E92", ink: [0.09, 300] },
  ramune: { label: "Ramune", vibe: "soda pop", body: "#E4EEF4", top: ["#B4D2E6", 0.8], belly: "#FAFCFC", nub: "#94B4CC", tail: "#88A6BE", sparkle: "#DDF0FA", blush: "#F4A8A8", ink: [0.09, 235] },
  peach: { label: "Peach", vibe: "white peach", body: "#FBE6D8", top: ["#F6C2A2", 0.75], belly: "#FFF4EA", nub: "#E0A688", tail: "#CC9478", blush: "#F2948A", ink: [0.11, 45] },
  yuzu: { label: "Yuzu", vibe: "citrus honey", body: "#F8F0D2", top: ["#F0D27E", 0.75], belly: "#FFF8E6", nub: "#D6B870", tail: "#C4A864", sparkle: "#FFF2C2", ink: [0.11, 90] },
  sesame: { label: "Sesame", vibe: "black sesame", body: "#E8E4DE", top: ["#B4ACA4", 0.6], belly: "#F6F2EC", nub: "#8C847E", tail: "#7A7470", speck: "#4E4844", ink: [0.02, 60] },
  earlgrey: { label: "Earl Grey", vibe: "milk tea", body: "#E2E4E8", top: ["#A8B0BE", 0.7], belly: "#F4EEE6", nub: "#8E96A6", tail: "#828A9A", blush: "#E8A49C", ink: [0.04, 260] },
  mintchoco: { label: "Mint Choco", vibe: "mint chip", body: "#DDF0E6", top: ["#A8D8C2", 0.7], belly: "#F4FAF6", nub: "#7A5E50", tail: "#6A5044", speck: "#6A5044", ink: [0.08, 165] },
  ichigo: { label: "Ichigo", vibe: "strawberry daifuku", body: "#FBF4EE", top: ["#EE9AA2", 0.85], belly: "#FFF8F4", nub: "#E2A4A8", tail: "#D09498", freckle: "#E07E88", blush: "#F28C94", ink: [0.12, 10] },
  kinako: { label: "Kinako", vibe: "midnight dango", body: "#3E4258", top: ["#2C3044", 0.7], belly: "#E2C890", nub: "#2C3044", tail: "#2A2E40", eye: "#141420", beak: "#E2C890", feet: "#A49A8A", blush: "#E89A9A", speck: "#F2DEA4", sparkle: "#F2DEA4", ink: [0.08, 275] },
} as const satisfies Record<string, Flavor>

export type FlavorId = keyof typeof FLAVORS
export const FLAVOR_IDS = Object.keys(FLAVORS) as FlavorId[]
/** Every flavor but Yuki's own cream: the colors another agent can wear. */
export const FRIEND_IDS = FLAVOR_IDS.filter((f) => f !== "yuki")

/** Gradient ids a drawing can use: a soft sheen and the body's outline as a clip. */
type Refs = { hl: string; clip: string }

/** Things a bird can wear, from the wardrobe. Muted fabrics, so the bird stays the hero. */
export const OUTFITS = {
  none: { label: "Nothing", svg: () => "" },
  beanie: {
    label: "Knit beanie",
    svg: (r: Refs) =>
      `<path d="M36 47 C36 31 46 23 60 23 C74 23 84 31 84 47Z" fill="#D9A3A0"/><path d="M36 47 C36 31 46 23 60 23 C74 23 84 31 84 47Z" fill="url(#${r.hl})"/><path d="M44 44 C44 36 46 30 50 26.6 M52 44 C52 36 53 30 55.6 24.6 M60 44 C60 36 60 30 60.6 23.4 M68 44 C68 36 67.4 30 65.6 24.6 M76 44 C76 37 74 31 70.6 26.6" fill="none" stroke="#C48E8B" stroke-width="1.1" stroke-linecap="round"/><rect x="33" y="43" width="54" height="9" rx="4.5" fill="#C99390"/><circle cx="60" cy="20" r="5.6" fill="#F5E8E2"/><circle cx="58.3" cy="18.4" r="2.1" fill="#fff" fill-opacity=".7"/>`,
  },
  scarf: {
    label: "Wool scarf",
    svg: (r: Refs) =>
      `<path d="M34 87 L29 105 L40 105 L42 90Z" fill="#94AE8E"/><path d="M27 79 C42 88 78 88 93 79 L94 88 C78 97 42 97 26 88Z" fill="#A8C2A0"/><path d="M27 79 C42 88 78 88 93 79 L94 88 C78 97 42 97 26 88Z" fill="url(#${r.hl})"/><path d="M36 85 L35 92 M46 88 L46 95 M56 89 L56 96 M66 89 L66 96 M76 88 L76 95 M86 85 L87 92" fill="none" stroke="#8AA484" stroke-width="1.3" stroke-linecap="round"/>`,
  },
  beret: {
    label: "Beret",
    svg: (r: Refs) =>
      `<path d="M56 29.5 L57.4 25" fill="none" stroke="#5D6E8E" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="56" cy="37" rx="25" ry="8.4" transform="rotate(-12 56 37)" fill="#6B7C9C"/><ellipse cx="56" cy="37" rx="25" ry="8.4" transform="rotate(-12 56 37)" fill="url(#${r.hl})"/>`,
  },
  bucket: {
    label: "Bucket hat",
    svg: (r: Refs) =>
      `<ellipse cx="60" cy="44" rx="31" ry="6.4" fill="#DCC797"/><path d="M39 44 C39 30 47 24 60 24 C73 24 81 30 81 44Z" fill="#E8D6A8"/><path d="M39 44 C39 30 47 24 60 24 C73 24 81 30 81 44Z" fill="url(#${r.hl})"/><path d="M40 40.4 C52 43 68 43 80 40.4 L80 43 C68 45.4 52 45.4 40 43Z" fill="#B8A06E"/>`,
  },
  phones: {
    label: "Headphones",
    svg: () =>
      `<path d="M29 60 C27 30 93 30 91 60" fill="none" stroke="#7E9282" stroke-width="4.4" stroke-linecap="round"/><ellipse cx="27" cy="62" rx="6.4" ry="9.4" fill="#9CB0A0"/><ellipse cx="25.6" cy="59" rx="2.4" ry="3.6" fill="#fff" fill-opacity=".3"/><ellipse cx="93" cy="62" rx="5.6" ry="9" fill="#8AA090"/>`,
  },
  crown: {
    label: "Flower crown",
    svg: () => {
      const flower = (x: number, y: number, petal: string, s = 1) =>
        `<g transform="translate(${x} ${y}) scale(${s})">${[0, 72, 144, 216, 288].map((a) => `<circle cx="0" cy="-3" r="2.8" transform="rotate(${a})" fill="${petal}"/>`).join("")}<circle r="1.6" fill="#F2D27A"/></g>`
      return `<path d="M36 40 C34 36 37 33 40 35 M80 40 C82 36 79 33 76 35" fill="none" stroke="#9DB87A" stroke-width="2.4" stroke-linecap="round"/>${flower(40, 39, "#F6C6CE")}${flower(51, 33.5, "#FBF7EE", 0.85)}${flower(61, 31.6, "#D8C6EA")}${flower(71, 33.5, "#FBF7EE", 0.85)}${flower(81, 39, "#F6C6CE")}`
    },
  },
  bow: {
    label: "Ribbon bow",
    svg: (r: Refs) =>
      `<g transform="translate(76 37) rotate(14)"><path d="M0 0 C-6 -8 -15 -6 -14 1 C-13 7 -6 6 0 0Z M0 0 C6 -8 15 -6 14 1 C13 7 6 6 0 0Z" fill="#F2A7B4"/><path d="M0 0 C-6 -8 -15 -6 -14 1 C-13 7 -6 6 0 0Z" fill="url(#${r.hl})"/><path d="M-1 1 L-5 10 L-2 9 L0 11Z M1 1 L5 10 L2 9 L0 11Z" fill="#E894A3"/><circle r="2.8" fill="#E894A3"/></g>`,
  },
  nightcap: {
    label: "Nightcap",
    svg: (r: Refs) =>
      `<path d="M37 47 C38 30 54 21 69 22 C84 23 96 34 101 52 C102.4 57 98.4 59.4 96.4 55.4 C92 45 85 39 82 47Z" fill="#B8CCE4"/><path d="M37 47 C38 30 54 21 69 22 C84 23 96 34 101 52 C102.4 57 98.4 59.4 96.4 55.4 C92 45 85 39 82 47Z" fill="url(#${r.hl})"/><g fill="#F6F2E8"><circle cx="52" cy="33" r="1.3"/><circle cx="64" cy="28" r="1.3"/><circle cx="76" cy="30" r="1.3"/><circle cx="86" cy="38" r="1.3"/><circle cx="58" cy="40" r="1.3"/><circle cx="72" cy="38" r="1.3"/></g><rect x="34" y="43" width="51" height="8" rx="4" fill="#F6F2E8"/><circle cx="99" cy="58" r="5" fill="#F6F2E8"/>`,
  },
  backpack: {
    label: "Tiny backpack",
    svg: () =>
      `<path d="M36 70 C40 80 42 90 44 99 M84 70 C80 80 78 90 76 99" fill="none" stroke="#B88A62" stroke-width="3.2" stroke-linecap="round"/><rect x="38.4" y="80" width="5" height="4" rx="1" fill="#E6C99A"/><rect x="77" y="80" width="5" height="4" rx="1" fill="#E6C99A"/>`,
  },
  leaf: {
    label: "Leaf umbrella",
    svg: (r: Refs) =>
      `<path d="M88 80 C90 60 84 40 72 26" fill="none" stroke="#6E8A58" stroke-width="2.2" stroke-linecap="round"/><path d="M26 31 C38 11 82 6 99 24 C82 27 50 31 26 31Z" fill="#9DB87A"/><path d="M26 31 C38 11 82 6 99 24 C82 27 50 31 26 31Z" fill="url(#${r.hl})"/><path d="M30 30 C50 22 76 18 96 24 M46 28 L50 18 M60 26 L64 14 M74 25 L80 14 M86 24.6 L91 17" fill="none" stroke="#86A266" stroke-width="1.2" stroke-linecap="round"/><ellipse cx="89" cy="81" rx="3.6" ry="2.6" fill="#BCA996"/>`,
  },
  bandana: {
    label: "Bandana",
    svg: (r: Refs) =>
      `<path d="M38 79 C50 85 70 85 82 79 L60 99Z" fill="#E99A7E"/><path d="M38 79 C50 85 70 85 82 79 L60 99Z" fill="url(#${r.hl})"/><g fill="#FBF2E6"><circle cx="52" cy="85" r="1.1"/><circle cx="60" cy="87" r="1.1"/><circle cx="68" cy="85" r="1.1"/><circle cx="56" cy="92" r="1.1"/><circle cx="64" cy="92" r="1.1"/></g>`,
  },
  sweater: {
    label: "Knit sweater",
    svg: (r: Refs) =>
      `<g clip-path="url(#${r.clip})"><rect x="20" y="80" width="80" height="30" fill="#C9B8D8"/><path d="M30 84 V104 M36 86 V104 M42 87 V104 M48 88 V104 M54 88 V104 M60 88 V104 M66 88 V104 M72 88 V104 M78 87 V104 M84 86 V104 M90 84 V104" fill="none" stroke="#B8A6CA" stroke-width="1.6" stroke-linecap="round"/></g><path d="M28 78 C43 87 77 87 92 78 L93 86 C77 95 43 95 27 86Z" fill="#B9A6CC"/>`,
  },
  // The seasons. Yuki wears the one for today in the brand mark and the empty chat (`scene.ts`).
  snowcap: {
    label: "First snow",
    svg: () =>
      `<path d="M41 37 C42 28 52 24.5 59 26 C67 24.5 78 28.5 78 37 C72 34.6 65 35.6 59.5 34.6 C53 35.8 47 37.6 41 37Z" fill="#FFFFFF"/><path d="M43 36 C49 35 54 34 59.5 34.6 C65 35.6 71 34.8 77 36" fill="none" stroke="#C9D6E6" stroke-width="1.6" stroke-linecap="round"/>`,
  },
  blossom: {
    label: "Sakura",
    svg: () =>
      `<g transform="translate(75 35) rotate(12)">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-4.6" rx="3.4" ry="4.6" transform="rotate(${a})" fill="#F7C4CF"/>`).join("")}<circle r="1.9" fill="#E58FA3"/></g>`,
  },
  momiji: {
    label: "Momiji",
    svg: () =>
      `<g transform="translate(75 35) rotate(-16)"><path d="M0 4 L0 10" stroke="#B4553A" stroke-width="1.2" stroke-linecap="round"/><path d="M0 -7.5 L1.8 -3 L5.6 -5 L4 -1 L7.6 0.4 L3.6 2 L4.6 5.4 L0.8 3.6 L0 6 L-0.8 3.6 L-4.6 5.4 L-3.6 2 L-7.6 0.4 L-4 -1 L-5.6 -5 L-1.8 -3Z" fill="#E0784C" stroke="#E0784C" stroke-width="0.8" stroke-linejoin="round"/></g>`,
  },
} as const satisfies Record<string, { label: string; svg: (r: Refs) => string }>

export type OutfitId = keyof typeof OUTFITS
export const OUTFIT_IDS = Object.keys(OUTFITS) as OutfitId[]

export type BirdSpec = { flavor: FlavorId; outfit: OutfitId }

/** The chief. Its flavor never changes; only what it wears does. */
export const YUKI: BirdSpec = { flavor: "yuki", outfit: "none" }

// --- ids ---------------------------------------------------------------------------

export const formatBird = (b: BirdSpec) => `${b.flavor}.${b.outfit}`

/** A stored pick. The old `species.tint.accessory` picks read as null, so those agents get their seeded bird. */
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

const SEED_OUTFITS: OutfitId[] = ["beanie", "scarf", "beret", "bucket", "phones", "crown", "bow", "bandana"]

/**
 * The bird a slug wears when nobody picked one. The chief is always Yuki. About a third of
 * the others wear something, so the flock reads as a family and not a uniform.
 */
export function seedBird(slug: string, chief: string): BirdSpec {
  if (slug === chief) return YUKI
  const h = hash(slug)
  const flavor = FRIEND_IDS[h % FRIEND_IDS.length]!
  const outfit = (h >>> 16) % 3 === 0 ? SEED_OUTFITS[(h >>> 20) % SEED_OUTFITS.length]! : "none"
  return { flavor, outfit }
}

// --- color -------------------------------------------------------------------------

/**
 * The color an agent's name and mentions use, kept readable on both appearances with
 * `light-dark`. Yuki uses the theme's accent.
 */
export function inkColor(b: BirdSpec): string {
  const ink: Flavor["ink"] = FLAVORS[b.flavor].ink
  if (!ink) return "var(--accent)"
  const [c, h] = ink
  const chroma = Math.max(c, 0.06)
  return `light-dark(oklch(0.5 ${chroma} ${h}), oklch(0.78 ${Math.min(chroma, 0.14)} ${h}))`
}

// --- drawing -----------------------------------------------------------------------

/** The body outline: a round snowball with a soft bumpy crown. */
const BODY = "M26 70 C24 52 34 37 48 35 C52 31 57 30 62 33 C67 30 74 31 77 36 C90 41 96 54 94 70 C94 90 80 102 60 102 C40 102 26 90 26 70Z"
/** The long thin tail, and the stubby one of the plush-toy look that small avatars use. */
const TAIL = "M38 86 C30 93 20 102 11 110 C9.5 111.6 11.5 113.8 13.3 112.6 C23 106 33 98 44 91Z"
const STUB = "M33 87 C27 91 21 95 15 98.5 C13.5 99.5 14.5 102 16.5 101.5 C23.5 99.5 30.5 96 37 92Z"
const FEET = "M53 101 L51.5 105.5 M55 101.5 L55 106 M65 101.5 L65 106 M67 101 L68.5 105.5"
const SPECKS = [[40, 48, 1], [47, 43, 0.8], [56, 40, 1], [66, 41, 0.8], [74, 44, 1], [82, 50, 0.8], [36, 58, 0.8], [86, 60, 1], [44, 52, 0.7], [78, 53, 0.7], [61, 46, 0.7]]
const FRECKLES = [[41.5, 70.5], [44, 72.2], [46.5, 70.6], [77, 70.2], [79.2, 71.7], [81.2, 70.3]]
const star = (x: number, y: number, s: number) =>
  `M${x} ${y - 5 * s} C${x + 0.6 * s} ${y - 1.6 * s} ${x + 1.6 * s} ${y - 0.6 * s} ${x + 5 * s} ${y} C${x + 1.6 * s} ${y + 0.6 * s} ${x + 0.6 * s} ${y + 1.6 * s} ${x} ${y + 5 * s} C${x - 0.6 * s} ${y + 1.6 * s} ${x - 1.6 * s} ${y + 0.6 * s} ${x - 5 * s} ${y} C${x - 1.6 * s} ${y - 0.6 * s} ${x - 0.6 * s} ${y - 1.6 * s} ${x} ${y - 5 * s}Z`

type Eyes = "bead" | "up" | "down" | "happy" | "closed"

/** Each mood as data: how the eyes look, and what the bird shows beside it. */
const MOODS: Record<BirdState, { eyes: Eyes; prop?: string; rosy?: boolean }> = {
  idle: { eyes: "bead" },
  thinking: {
    eyes: "up",
    prop: `<g class="bird-think" fill="var(--text-faint, #CFC3B4)"><circle cx="92" cy="40" r="2.2"/><circle cx="98.5" cy="31" r="3"/><circle cx="105" cy="20.5" r="3.8"/></g>`,
  },
  working: { eyes: "down", prop: `<g class="bird-spark" fill="#F6E6B4"><path d="${star(92, 34, 1)}"/><path d="${star(100, 46, 0.48)}"/></g>` },
  typing: { eyes: "down" },
  sending: {
    eyes: "happy",
    prop: `<g class="bird-plane"><path d="M84 32 L104 22 L97 40 L93 34Z" fill="var(--accent, #E9C9C2)"/><path d="M93 34 L104 22" stroke="#fff" stroke-width="1" opacity=".6"/></g>`,
  },
  wave: { eyes: "happy" },
  sleeping: {
    eyes: "closed",
    rosy: true,
    prop: `<g class="bird-zz" fill="var(--text-faint, #CFC3B4)" font-family="inherit" font-weight="600"><text x="84" y="44" font-size="9">z</text><text x="92" y="33" font-size="12">z</text></g>`,
  },
}

function eyes(kind: Eyes, ink: string): string {
  if (kind === "happy") return `<path d="M47.6 64 Q51 59.6 54.4 64 M68.8 64 Q72 59.8 75.2 64" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`
  if (kind === "closed") return `<path d="M47.5 63 Q51 65.8 54.5 63 M68.5 63 Q72 65.6 75.5 63" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`
  const dy = kind === "up" ? -1.4 : kind === "down" ? 1 : 0
  const r = kind === "down" ? 0.88 : 1
  return (
    `<g class="bird-eyes"><circle cx="51" cy="${63 + dy}" r="${3.6 * r}" fill="${ink}"/><circle cx="72" cy="${63 + dy}" r="${3.3 * r}" fill="${ink}"/>` +
    `<circle cx="49.9" cy="${61.8 + dy}" r="1.3" fill="#fff"/><circle cx="71" cy="${61.9 + dy}" r="1.2" fill="#fff"/>` +
    `<circle cx="52.1" cy="${64.3 + dy}" r=".5" fill="#fff" fill-opacity=".7"/><circle cx="73" cy="${64.2 + dy}" r=".45" fill="#fff" fill-opacity=".7"/></g>`
  )
}

let uid = 0

/**
 * How a bird is drawn: on the ground with a soft shadow, flat with no shading for the favicon,
 * and with a stubby tail where a long one would read as a stick.
 */
export type DrawOptions = { ground?: boolean; flat?: boolean; stub?: boolean }

/** The SVG markup for a bird, in a 120-unit box. Pure, so tests and scripts can call it. */
export function birdSvg(b: BirdSpec, state: BirdState = "idle", opts: DrawOptions = {}): string {
  const f: Flavor = FLAVORS[b.flavor]
  const mood = MOODS[state]
  const id = `yb${uid++}`
  const refs: Refs = { hl: `${id}h`, clip: `${id}c` }
  const ink = f.eye ?? "#3A302C"
  const beak = f.beak ?? "#7A6458"
  const blush = f.blush ?? "#F4A99A"
  const blushOp = mood.rosy ? 0.85 : 0.65
  const fade = (gid: string, color: string, op: number) =>
    `<radialGradient id="${gid}"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`

  const defs = opts.flat
    ? `<defs><clipPath id="${refs.clip}"><path d="${BODY}"/></clipPath><linearGradient id="${refs.hl}"><stop stop-opacity="0"/></linearGradient>` +
      (opts.ground ? fade(`${id}g`, "#000", 0.3) : "") +
      `</defs>`
    : `<defs><clipPath id="${refs.clip}"><path d="${BODY}"/></clipPath>` +
      `<radialGradient id="${refs.hl}" cx=".36" cy=".24" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".5" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${id}s" cx=".46" cy=".3" r=".82"><stop offset=".6" stop-color="#5A4A40" stop-opacity="0"/><stop offset="1" stop-color="#5A4A40" stop-opacity=".26"/></radialGradient>` +
      fade(`${id}b`, f.belly, 0.85) +
      fade(`${id}k`, blush, blushOp) +
      (f.top ? fade(`${id}t`, f.top[0], f.top[1]) : "") +
      (opts.ground ? fade(`${id}g`, "#000", 0.3) : "") +
      `</defs>`

  // Inside the body's outline: the crown fade, the belly and any specks. Then the shading over the whole body.
  const inside = opts.flat
    ? `<path d="M36 92 C44 99 76 99 84 92 C78 101 42 101 36 92Z" fill="${f.belly}"/>`
    : (f.top ? `<ellipse cx="60" cy="32" rx="50" ry="26" fill="url(#${id}t)"/>` : "") +
      `<ellipse cx="62" cy="88" rx="25" ry="14" fill="url(#${id}b)"/>` +
      (f.speck ? `<g fill="${f.speck}" fill-opacity=".55">${SPECKS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("")}</g>` : "")
  const over = opts.flat ? "" : `<path d="${BODY}" fill="url(#${id}s)"/><path d="${BODY}" fill="url(#${refs.hl})"/>`

  const cheeks = opts.flat
    ? `<ellipse cx="44" cy="71" rx="3.8" ry="2.4" fill="${blush}"/><ellipse cx="79" cy="70.5" rx="3.4" ry="2.2" fill="${blush}"/>`
    : `<ellipse cx="44" cy="71" rx="7.4" ry="4.6" fill="url(#${id}k)"/><ellipse cx="79" cy="70.5" rx="6.2" ry="4.2" fill="url(#${id}k)"/>`

  return (
    defs +
    (opts.ground ? `<ellipse class="bird-shadow" cx="60" cy="108" rx="34" ry="5" fill="url(#${id}g)"/>` : "") +
    `<g class="bird-body">` +
    `<path d="${opts.stub ? STUB : TAIL}" fill="${f.tail}"/>` +
    `<path class="bird-feet" d="${FEET}" fill="none" stroke="${f.feet ?? "#8C7A6E"}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="${BODY}" fill="${f.body}"/>` +
    `<g clip-path="url(#${refs.clip})">${inside}</g>` +
    over +
    `<ellipse cx="33" cy="76" rx="6" ry="10" transform="rotate(16 33 76)" fill="${f.nub}"/>` +
    `<g class="bird-wing"><ellipse cx="87.5" cy="76" rx="3.8" ry="8" transform="rotate(-14 87.5 76)" fill="${f.nub}" fill-opacity=".8"/></g>` +
    eyes(mood.eyes, ink) +
    `<path d="M59.2 68.6 C60.3 67.4 63.7 67.4 64.8 68.6 L62 71.8Z" fill="${beak}" stroke="${beak}" stroke-width=".8" stroke-linejoin="round"/>` +
    cheeks +
    (f.freckle ? `<g fill="${f.freckle}" fill-opacity=".55">${FRECKLES.map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".6"/>`).join("")}</g>` : "") +
    (f.sparkle ? `<g fill="${f.sparkle}" fill-opacity=".9"><path d="${star(88, 35, 1)}"/><path d="${star(96, 44.4, 0.48)}"/></g>` : "") +
    OUTFITS[b.outfit].svg(refs) +
    `</g>` +
    (mood.prop ?? "")
  )
}

/** The box every bird is drawn in: square, centered on the body, with room for the tail. */
export const BIRD_VIEWBOX = "8 18 100 100"
