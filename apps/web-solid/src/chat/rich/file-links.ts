import { fileName } from "@kiko/protocol"
/*
 * Which parts of an agent's message name a file, after t3code's markdown file links. A link
 * whose href is a path, and inline code that is clearly a path, become a chip that opens the
 * file in the files tab. Prose and fenced code never do. Pure, so the table test covers it.
 */

/** A file a message names: its path as written, without `./` or a leading slash, and its line. */
export type FileTarget = { path: string; line?: number; column?: number }

const RELATIVE_PREFIX = /^(~\/|\.{1,2}\/)/
const RELATIVE_FILE_PATH = /^(?:[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*\/)+[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*(?::\d+){0,2}$/
const RELATIVE_FILE_NAME = /^[A-Za-z0-9._-]+(?: +[A-Za-z0-9._-]+)*(?::\d+){0,2}$/
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/
const URL_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
const POSITION = /:\d+(?::\d+)?$/
const POSITION_CAPTURE = /:(\d+)(?::(\d+))?$/
const POSITION_HASH = /^#L(\d+)(?:C(\d+))?$/i
const POSITION_ONLY = /^\d+(?::\d+)?$/
const EXTENSION = /\.[A-Za-z0-9_-]+$/
// A final dot between digits is a version or a model id (`glm-5.3`), not an extension.
const VERSION_SUFFIX = /\d\.\d[^.]*$/
const NUMERIC_DOTTED = /^\d+(?:\.\d+)+$/
// A `Name:digits` code span is also `error:1` or `port:3000`, so only these names count without a dot.
const EXTENSIONLESS = new Set(["Makefile", "Dockerfile", "Justfile", "Procfile", "LICENSE", "CHANGELOG", "README", "CODEOWNERS"])
const HOST_TLDS = new Set(["com", "net", "org", "io", "dev", "app", "ai", "co", "edu", "gov", "info", "xyz", "me", "chat", "cloud", "site", "tech", "link"])
// Country codes are also file extensions (`.pl`, `.pt`), so a `:line` suffix makes them files.
const COUNTRY_TLDS = new Set(["uk", "de", "fr", "nl", "se", "no", "fi", "dk", "pl", "ch", "at", "be", "es", "it", "pt", "eu", "us", "ca", "au", "nz", "jp", "kr", "cn", "br", "ru", "mx", "ie", "cz", "tr", "sg", "hk"])

function looksLikeHostname(segment: string, hasPosition: boolean): boolean {
  if (segment.startsWith(".")) return false
  const lowered = segment.toLowerCase()
  if (lowered === "localhost" || NUMERIC_DOTTED.test(segment)) return true
  const labels = lowered.split(".")
  const last = labels.at(-1)!
  if (labels.length < 2) return false
  return HOST_TLDS.has(last) || (!hasPosition && COUNTRY_TLDS.has(last))
}

const decode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Splits a `:line` or `:line:col` suffix, or a `#L3C2` anchor, off a path. */
export function splitPosition(path: string, hash = ""): FileTarget {
  const suffix = path.match(POSITION_CAPTURE)
  const match = suffix ?? hash.match(POSITION_HASH)
  if (!match?.[1]) return { path }
  const line = Number(match[1])
  const column = match[2] === undefined ? 0 : Number(match[2])
  return {
    path: suffix ? path.slice(0, -suffix[0].length) : path,
    ...(line > 0 ? { line } : {}),
    ...(column > 0 ? { column } : {}),
  }
}

/** Drops `./` and the leading slash, and folds `..`, so a target reads as a workspace path. */
function workspacePath(path: string): string {
  const out: string[] = []
  for (const part of path.replace(/^~\//, "").split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") out.pop()
    else out.push(part)
  }
  return out.join("/")
}

function target(path: string, hash = ""): FileTarget | null {
  const { path: raw, line, column } = splitPosition(path, hash)
  const clean = workspacePath(raw)
  if (!clean) return null
  return { path: clean, ...(line ? { line } : {}), ...(column ? { column } : {}) }
}

/**
 * Inline code that is a path: it needs a slash or a `:line` suffix, is not a hostname or a
 * version, and has an extension unless it starts with `/`, `./` or `../`.
 */
export function inlineCodeFile(code: string): FileTarget | null {
  const text = code.trim()
  if (!text || /[\s`]/.test(text)) return null
  // A URL such as `https://example.com/index.html` is a link, not a file.
  if (URL_PREFIX.test(text)) return null
  const hasPosition = POSITION.test(text)
  if (!hasPosition && !text.includes("/")) return null
  if (!RELATIVE_PREFIX.test(text) && !text.startsWith("/")) {
    const bare = text.replace(POSITION, "")
    if (looksLikeHostname(bare.split("/")[0]!, hasPosition)) return null
    const name = bare.replace(/\/+$/, "").split("/").at(-1) ?? ""
    if (VERSION_SUFFIX.test(name)) return null
    if (!hasPosition && !EXTENSION.test(name)) return null
  }
  return target(text)
}

/**
 * Inline code that is a bare file name, such as `panel.tsx` or `report 1–13.png`. Names may hold
 * spaces and punctuation, but never a slash, a backtick or a line break. The caller only makes a
 * chip when the chat has a file of that name, so `Promise.all` or `node.meta` stays code.
 */
export function bareFileName(code: string): FileTarget | null {
  const text = code.trim()
  if (!text || /[`/\n]/.test(text)) return null
  if (!/^[^.].*\.[A-Za-z][A-Za-z0-9_-]{0,9}(?::\d+){0,2}$/.test(text)) return null
  const { path, line, column } = splitPosition(text)
  return { path, ...(line ? { line } : {}), ...(column ? { column } : {}) }
}

/** An absolute path counts when it has an extension or a line, so `/chat/settings` stays a route. A
 * trailing slash marks a folder, which the app's own file links use and no route does. */
function looksLikeFilePath(path: string, authored: string): boolean {
  if (RELATIVE_PREFIX.test(path)) return true
  if (path.endsWith("/") && path.length > 1) return true
  if (path.startsWith("/")) {
    const name = path.slice(path.lastIndexOf("/") + 1)
    return POSITION.test(authored) || EXTENSIONLESS.has(name) || EXTENSION.test(name)
  }
  return RELATIVE_FILE_PATH.test(authored) || RELATIVE_FILE_NAME.test(path)
}

/** A link's href as a file: a path with an optional `:line`, or a `file:` URL. Web links are not files. */
export function hrefFile(href: string): FileTarget | null {
  let value = href.trim()
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1)
  if (!value || value.startsWith("#") || value.startsWith("//")) return null
  let path: string
  let hash = ""
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value)
      path = url.pathname
      hash = url.hash
    } catch {
      return null
    }
  } else {
    const at = value.indexOf("#")
    hash = at >= 0 ? value.slice(at) : ""
    path = (at >= 0 ? value.slice(0, at) : value).split("?")[0]!
  }
  path = decode(path.trim())
  hash = decode(hash)
  const scheme = path.match(SCHEME)
  if (!path || (scheme && (scheme[2]!.startsWith("//") || !POSITION_ONLY.test(scheme[2]!)))) return null
  const { path: bare } = splitPosition(path, hash)
  // A web address written without a scheme, such as `example.com`, is a link, not a file.
  if (!RELATIVE_PREFIX.test(bare) && !bare.startsWith("/") && looksLikeHostname(bare.split("/")[0]!, true)) return null
  return looksLikeFilePath(bare, path) ? target(path, hash) : null
}

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1)

/** True when a link's text is just its file's name or path, so the chip alone stands for it. */
export function isFileLabel(label: string, file: FileTarget): boolean {
  const own = splitPosition(label.trim())
  if ((own.line !== undefined && own.line !== file.line) || (own.column !== undefined && own.column !== file.column)) return false
  const path = workspacePath(own.path)
  return path === "" || path === file.path || file.path.endsWith(`/${path}`) || path === fileName(file.path)
}

/**
 * For files in one message that share a name, the shortest parent folders that tell them
 * apart, at least two deep, as t3code labels them. A name used once gets nothing.
 */
export function parentSuffixes(paths: readonly string[]): Map<string, string> {
  const groups = new Map<string, Set<string>>()
  for (const path of paths) {
    const name = basename(path)
    groups.set(name, (groups.get(name) ?? new Set()).add(path))
  }
  const out = new Map<string, string>()
  for (const group of groups.values()) {
    if (group.size < 2) continue
    const parents = new Map([...group].map((p) => [p, p.split("/").slice(0, -1)]))
    for (const [path, segments] of parents) {
      if (segments.length === 0) continue
      let depth = segments.length
      for (let d = 1; d <= segments.length; d++) {
        const tail = segments.slice(-d).join("/")
        if (![...parents].some(([other, s]) => other !== path && s.slice(-d).join("/") === tail)) {
          depth = d
          break
        }
      }
      out.set(path, segments.slice(-Math.min(segments.length, Math.max(depth, 2))).join("/"))
    }
  }
  return out
}

/** The chip's text: the name, its parent folders when another chip shares it, and its line. */
export function chipLabel(file: FileTarget, suffix?: string): string {
  // An upload is stored as `attachments/<stamp>-<name>`. The chip says the name the human picked.
  const parts = [fileName(file.path)]
  if (suffix) parts.push(suffix)
  if (file.line) parts.push(`L${file.line}${file.column ? `:C${file.column}` : ""}`)
  return parts.join(" · ")
}

export type Resolved = { kind: "file"; path: string } | { kind: "folder"; path: string } | { kind: "none" } | { kind: "many" }

/**
 * Finds a named path in a chat's index, whose names are full paths. An exact file wins, then a
 * folder: a path with anything below it is a folder, the same rule the server's index uses.
 * A bare name, or a path the index only ends with, opens its one match. No match, or more
 * than one, is reported so the chip can say so.
 */
export function resolveFile(path: string, index: readonly string[], folders: readonly string[] = []): Resolved {
  if (index.includes(path)) return { kind: "file", path }
  // A folder the agent linked, which the tree draws and the panel can open.
  if (folders.includes(path) || index.some((name) => name.startsWith(`${path}/`))) return { kind: "folder", path }
  const matches = index.filter((name) => name.endsWith(`/${path}`))
  if (matches.length === 1) return { kind: "file", path: matches[0]! }
  return matches.length === 0 ? { kind: "none" } : { kind: "many" }
}
