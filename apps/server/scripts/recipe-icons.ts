/*
 * Picks a Phosphor icon and a tone for a recipe from its words, with no model call. A synonym wins
 * outright; otherwise the curated icons are scored by their own names and tags. Build time only.
 */
import { icons } from "@phosphor-icons/core"
import type { RecipeTone } from "@kiko/protocol"

const SYNONYMS: Record<string, string> = {
  morning: "sun-horizon", briefing: "sun-horizon", sunrise: "sun-horizon",
  weather: "cloud-sun", forecast: "cloud-sun", rain: "umbrella", storm: "cloud-lightning",
  pollen: "flower-lotus", allergy: "flower-lotus", meditate: "flower-lotus", mindful: "flower-lotus",
  meme: "smiley-wink", joke: "smiley-wink", funny: "smiley-wink", mood: "smiley",
  decide: "scales", decision: "scales", council: "scales", tradeoff: "scales",
  email: "envelope-simple", inbox: "envelope-simple", mail: "envelope-simple", newsletter: "newspaper-clipping",
  receipt: "receipt", invoice: "receipt", expense: "receipt",
  flight: "airplane-tilt", travel: "suitcase-rolling", trip: "suitcase-rolling", hotel: "bed",
  calendar: "calendar-check", deadline: "calendar-check", meeting: "users-three", schedule: "calendar-dots",
  subscription: "credit-card", bill: "credit-card", budget: "wallet", money: "wallet", spend: "wallet",
  stock: "chart-line-up", market: "chart-line-up", invest: "chart-line-up", crypto: "currency-btc",
  birthday: "cake", gift: "gift", anniversary: "heart",
  read: "book-open", book: "book-open", reading: "book-open", news: "newspaper", article: "article",
  water: "drop", hydration: "drop", sleep: "moon-stars", night: "moon-stars", bedtime: "moon-stars",
  gratitude: "hand-heart", journal: "notebook", reflect: "notebook", diary: "notebook",
  workout: "barbell", gym: "barbell", fitness: "barbell", run: "sneaker-move", walk: "person-simple-walk", step: "footprints",
  meal: "fork-knife", food: "fork-knife", lunch: "fork-knife", dinner: "fork-knife", cook: "cooking-pot", recipe: "cooking-pot", grocery: "shopping-cart",
  apartment: "house-line", rent: "house-line", home: "house-line", house: "house-line", plant: "plant", garden: "plant",
  job: "briefcase", career: "briefcase", interview: "briefcase", focus: "target", goal: "target", habit: "check-circle", todo: "list-checks", task: "list-checks",
  github: "github-logo", pull: "git-pull-request", code: "code", bug: "bug", deploy: "rocket-launch",
  followup: "paper-plane-tilt", follow: "paper-plane-tilt", reply: "paper-plane-tilt", reminder: "bell-ringing", alert: "bell-ringing",
  idea: "lightbulb", brainstorm: "lightbulb", learn: "graduation-cap", study: "graduation-cap", language: "translate", translate: "translate", quiz: "question",
  music: "music-notes", playlist: "music-notes", podcast: "microphone", photo: "camera", video: "video-camera", movie: "film-slate",
  cat: "cat", dog: "dog", pet: "paw-print", baby: "baby", family: "users-three", friend: "users", call: "phone",
  price: "tag", deal: "tag", shop: "shopping-bag", package: "package", delivery: "package", car: "car", commute: "train",
  research: "magnifying-glass", summary: "list-bullets", digest: "list-bullets", report: "chart-bar", health: "heartbeat", doctor: "first-aid", medicine: "pill",
  horoscope: "planet", astrology: "planet", prayer: "hands-praying", bible: "book-bookmark", verse: "book-bookmark", quote: "quotes", fact: "lightbulb-filament",
}

const CURATED = new Set(Object.values(SYNONYMS))
const SKIP = new Set(["arrows", "system", "editor"])

const TONES: Record<string, RecipeTone> = {
  finances: "green", commerce: "green", nature: "green", communications: "blue", "maps & travel": "teal", weather: "amber",
  objects: "orange", media: "pink", design: "pink", games: "violet", "health & wellness": "red", people: "violet",
  office: "amber", "technology & development": "slate", brands: "slate",
}

const STOP = new Set("the and for you your with from into that this each every when about are its get using use based".split(" "))
const stem = (w: string) => w.replace(/ies$/, "y").replace(/(ing|ers|es|s|ed)$/, "")
const words = (s: string) => s.toLowerCase().replace(/follow-up/g, "followup").split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w))

const byName = new Map(icons.map((i) => [i.name, i]))

export function pickIcon(title: string, description: string): string {
  for (const w of [...words(title), ...words(description)]) {
    const hit = SYNONYMS[w] ?? SYNONYMS[stem(w)]
    if (hit) return hit
  }
  const want = new Map<string, number>()
  for (const w of words(title)) want.set(stem(w), 3)
  for (const w of words(description)) if (!want.has(stem(w))) want.set(stem(w), 1)
  let best = "sparkle"
  let top = 0
  for (const icon of icons) {
    if (icon.categories.every((c) => SKIP.has(c))) continue
    const own = new Set(words(icon.name.replace(/-/g, " ")).map(stem))
    const tags = new Set(icon.tags.flatMap(words).map(stem))
    let score = 0
    for (const [w, weight] of want) score += own.has(w) ? 3 * weight : tags.has(w) ? weight : 0
    if (CURATED.has(icon.name)) score *= 1.5
    if (score > top) [best, top] = [icon.name, score]
  }
  return top >= 3 ? best : "sparkle"
}

export function toneOf(icon: string): RecipeTone {
  const found = byName.get(icon) ?? (() => { throw new Error(`no Phosphor icon named ${icon}`) })()
  for (const c of found.categories) {
    const tone = TONES[c]
    if (tone) return tone
  }
  return "slate"
}
