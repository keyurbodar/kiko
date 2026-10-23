import convertPunycode from "./punycode"
import { normalizeUrlProtocol } from "./url"

const RECOMMENDED_SCRIPTS = [
  "Latin",
  "Cyrillic",
  "Greek",
  "Armenian",
  "Hebrew",
  "Arabic",
  "Thaana",
  "Devanagari",
  "Bengali",
  "Gurmukhi",
  "Gujarati",
  "Oriya",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Sinhala",
  "Thai",
  "Lao",
  "Tibetan",
  "Myanmar",
  "Georgian",
  "Ethiopic",
  "Khmer",
  "Han",
  "Hiragana",
  "Katakana",
  "Hangul",
  "Bopomofo",
] as const

type Script = (typeof RECOMMENDED_SCRIPTS)[number]

const SCRIPT_REG_EXPS = RECOMMENDED_SCRIPTS.map((script) => [script, new RegExp(`\\p{Script=${script}}`, "u")] as const)
const LETTER_REG_EXP = /\p{L}/u
const SCRIPTLESS_REG_EXP = /[\p{Script=Common}\p{Script=Inherited}]/u

const ALLOWED_SCRIPT_SETS: Script[][] = [
  ["Han", "Hiragana", "Katakana"],
  ["Han", "Hangul"],
  ["Han", "Bopomofo"],
]

const LATIN_CONFUSABLE_SCRIPTS: Script[] = ["Cyrillic", "Greek", "Armenian"]

const scriptsCache: Map<string, Script | null> = new Map()
function getScript(char: string) {
  let script = scriptsCache.get(char)
  if (script === undefined) {
    if (scriptsCache.size > 1024) {
      scriptsCache.clear()
    }

    script = SCRIPT_REG_EXPS.find(([, regExp]) => regExp.test(char))?.[0] ?? null
    scriptsCache.set(char, script)
  }

  return script
}

function getLabelScripts(label: string): Set<Script> | undefined {
  const scripts: Set<Script> = new Set()
  for (const char of label) {
    if (!LETTER_REG_EXP.test(char) || SCRIPTLESS_REG_EXP.test(char)) {
      continue
    }

    const script = getScript(char)
    if (!script) {
      return
    }

    scripts.add(script)
  }

  return scripts
}

export default function isSuspiciousUrl(url: string): boolean {
  url = normalizeUrlProtocol(url)

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (e) {
    return true
  }

  if (parsed.username || parsed.password) {
    return true
  }

  let hostname: string
  try {
    hostname = convertPunycode(parsed.hostname)
  } catch (e) {
    return true
  }

  const labels = hostname.toLowerCase().split(".")
  if (labels.length > 1 && labels[0] === "www") {
    labels.shift()
  }

  const domainScripts: Set<Script> = new Set()
  for (const label of labels) {
    const scripts = getLabelScripts(label)
    if (!scripts) {
      return true
    }

    if (
      scripts.size > 1 &&
      !ALLOWED_SCRIPT_SETS.some((allowed) => Array.from(scripts).every((script) => allowed.includes(script)))
    ) {
      return true
    }

    scripts.forEach((script) => domainScripts.add(script))
  }

  return domainScripts.has("Latin") && LATIN_CONFUSABLE_SCRIPTS.some((s) => domainScripts.has(s))
}
