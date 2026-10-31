const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g")
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g")
const ESCAPE = new RegExp(`${ESC}[@-_]`, "g")

export function plain(text: string): string {
  return stripControls(text.replace(OSC, "").replace(CSI, "").replace(ESCAPE, "").replace(/\r\n?/g, "\n"))
}

function stripControls(text: string): string {
  let out = ""
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code === 9 || code === 10 || code >= 32) out += char
  }
  return out
}

const TAIL_CHARS = 16_384

export function plainTail(text: string): string {
  const tail = text.length > TAIL_CHARS ? text.slice(text.length - TAIL_CHARS) : text
  return plain(tail)
}

const CSI_QUERY = new RegExp(`${ESC}\\[([0-9;?>]*)([ -/]*)([@-~])`, "g")
const DCS_QUERY = new RegExp(`${ESC}P[^${ESC}${BEL}]*(?:${BEL}|${ESC}\\\\)`, "g")
const OSC_QUERY = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g")

function dropCsi(match: string, body: string, intermediates: string, final: string): string {
  if (intermediates.length > 0 && final !== "q") return match
  if (final === "n") return ""
  if (final === "R" && /^[0-9;?]*$/.test(body)) return ""
  if (final === "c" && /^[>0-9;?]*$/.test(body)) return ""
  if ((final === "p" || final === "y") && /^[0-9;?]*\$$/.test(body)) return ""
  if (final === "q" && /^>[0-9;]*$/.test(body)) return ""
  if (final === "u" && body.startsWith("?")) return ""
  return match
}

function contentOf(match: string): string {
  const body = match.slice(2)
  if (body.endsWith(`${ESC}\\`)) return body.slice(0, -2)
  return body.slice(0, -1)
}

export function replay(text: string, budget: number): string {
  const tail = text.length > budget ? text.slice(text.length - budget) : text
  const fromLine = tail.length === text.length ? 0 : tail.indexOf("\n") + 1
  const history = fromLine > 0 && fromLine < tail.length ? tail.slice(fromLine) : tail
  return history
    .replace(CSI_QUERY, dropCsi)
    .replace(DCS_QUERY, (match) => (/^[01]?[$+][qr]/.test(contentOf(match)) ? "" : match))
    .replace(OSC_QUERY, (match) => (/^(?:10|11|12);(?:\?|rgb:)/.test(contentOf(match)) ? "" : match))
}
