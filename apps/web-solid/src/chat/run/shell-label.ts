export type ShellIcon = "file-view" | "folder" | "globe" | "search" | "terminal"

export type ShellLabel = { label: string; icon: ShellIcon }

const LABEL_CHARS = 80
const CD = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*&&\s*/
const SHELL_SYNTAX = /[|;&<>$`()\\*?{}\n]/
const READERS = new Set(["cat", "head", "tail", "less", "more"])
const READER_VALUES = new Set(["-n", "-c", "--lines", "--bytes"])
const SEARCHERS = new Set(["grep", "rg"])
const SEARCH_VALUES = new Set(["-e", "-f", "-A", "-B", "-C", "-m", "-g", "-t", "--glob", "--type", "--max-count"])
const CURL_SENDS = new Set([
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "--json",
  "-F",
  "--form",
  "-T",
  "--upload-file",
])
const CURL_VALUES = new Set(["-o", "--output", "-H", "--header", "-w", "--write-out", "-A", "-m", "--max-time", "-u"])
const PLAIN_PATTERN = /^[\w .:/-]{1,40}$/

const cut = (text: string) => (text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text)

const unquote = (word: string) => word.replace(/^(["'])(.*)\1$/, "$2")

function withoutCd(command: string): { rest: string; dir?: string } {
  let rest = command.trim()
  let dir: string | undefined
  for (let at = CD.exec(rest); at; at = CD.exec(rest)) {
    dir = at[0].replace(/^cd\s+/, "").replace(/\s*&&\s*$/, "")
    rest = rest.slice(at[0].length).trimStart()
  }
  return dir === undefined ? { rest } : { rest, dir: unquote(dir) }
}

const words = (command: string) => [...command.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((m) => unquote(m[0]))

function operands(args: readonly string[], valued: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith("-")) out.push(arg)
    else if (valued.has(arg)) i++
  }
  return out
}

function readLabel(program: string, args: readonly string[]): ShellLabel | undefined {
  if (program === "tail" && args.some((arg) => arg === "-f" || arg === "-F" || arg === "--follow")) return undefined
  const files = operands(args, READER_VALUES)
  return files.length === 1 ? { label: `Read ${files[0]}`, icon: "file-view" } : undefined
}

function sedLabel(args: readonly string[]): ShellLabel | undefined {
  const [flag, script, file, ...rest] = args
  if (flag !== "-n" || !script || !/^\d+(,\d+)?p$/.test(script) || !file || rest.length) return undefined
  return { label: `Read ${file}`, icon: "file-view" }
}

function listLabel(args: readonly string[], dir: string | undefined): ShellLabel | undefined {
  const dirs = operands(args, new Set())
  if (dirs.length > 1) return undefined
  const where = dirs[0] ?? dir
  return { label: where ? `Listed ${where}` : "Listed the folder", icon: "folder" }
}

function searchLabel(args: readonly string[]): ShellLabel | undefined {
  const [pattern, ...paths] = operands(args, SEARCH_VALUES)
  if (!pattern || !PLAIN_PATTERN.test(pattern) || paths.length > 1) return undefined
  const where = paths[0] ? ` in ${paths[0]}` : ""
  return { label: `Searched for “${pattern}”${where}`, icon: "search" }
}

function fetchLabel(args: readonly string[]): ShellLabel | undefined {
  if (args.some((arg) => CURL_SENDS.has(arg))) return undefined
  const method = args.findIndex((arg) => arg === "-X" || arg === "--request")
  if (method >= 0 && args[method + 1]?.toUpperCase() !== "GET") return undefined
  const urls = operands(args, CURL_VALUES).filter((arg) => /^https?:\/\//.test(arg))
  if (urls.length !== 1) return undefined
  try {
    const url = new URL(urls[0]!)
    const path = url.pathname === "/" ? "" : url.pathname
    return { label: `Fetched ${url.host}${path}`, icon: "globe" }
  } catch {
    return undefined
  }
}

function knownLabel(program: string, args: readonly string[], dir: string | undefined): ShellLabel | undefined {
  if (READERS.has(program)) return readLabel(program, args)
  if (program === "sed") return sedLabel(args)
  if (program === "ls") return listLabel(args, dir)
  if (SEARCHERS.has(program)) return searchLabel(args)
  if (program === "curl" || program === "wget") return fetchLabel(args)
  return undefined
}

export function shellLabel(command: string): ShellLabel | undefined {
  const { rest, dir } = withoutCd(command)
  const line = rest.replace(/\s+/g, " ").trim()
  if (!line) return undefined
  const bare = line.replace(/"[^"]*"|'[^']*'/g, "")
  if (!SHELL_SYNTAX.test(bare)) {
    const [program, ...args] = words(line)
    const known = program ? knownLabel(program, args, dir) : undefined
    if (known) return { ...known, label: cut(known.label) }
  }
  return { label: `Ran ${cut(line)}`, icon: "terminal" }
}
