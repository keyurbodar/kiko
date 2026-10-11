const STOP = new Set(
  "the a an of to be which element should clicked on is for in and or open see that this with me my it at by from then please go get find".split(" "),
)

const ORDINALS: Record<string, string> = {
  first: "1",
  second: "2",
  third: "3",
  fourth: "4",
  fifth: "5",
  sixth: "6",
  seventh: "7",
  eighth: "8",
  ninth: "9",
  tenth: "10",
}

/** Lowercase words with ordinals as plain numbers: "3rd" and "third" both become "3". */
export function rawWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => ORDINALS[w] ?? w)
}

/** Goal words without stop words. Adjacent pairs are also joined, so "log in" matches a "login" link. */
export function goalWords(s: string): string[] {
  const raw = rawWords(s)
  const joined = raw.slice(1).map((w, i) => raw[i] + w)
  return [...new Set([...raw, ...joined].filter((w) => !STOP.has(w)))]
}
