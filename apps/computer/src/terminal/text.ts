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
