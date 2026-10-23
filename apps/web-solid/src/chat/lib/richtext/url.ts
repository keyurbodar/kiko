const SKIP_PROTOCOLS: Set<string> = new Set(["javascript:"])

export function checkBrackets(url: string): string {
  let urlLength = url.length
  const urlOpenBrackets = url.split("(").length - 1
  let urlCloseBrackets = url.split(")").length - 1
  while (urlCloseBrackets > urlOpenBrackets && url.charAt(urlLength - 1) === ")") {
    url = url.substr(0, urlLength - 1)
    urlCloseBrackets--
    urlLength--
  }
  if (urlOpenBrackets > urlCloseBrackets) {
    url = url.replace(/\)+$/, "")
  }
  return url
}

const STRIPPED_REG_EXP = /[\t\n\r]/g
const PROTOCOL_REG_EXP = /^([a-z][a-z\d+\-.]*):/i

function stripLeadingControls(text: string): string {
  let at = 0
  while (at < text.length && text.charCodeAt(at) <= 0x20) at += 1
  return text.slice(at)
}

function matchUrlProtocolText(text: string): string | false {
  const match = stripLeadingControls(text.replace(STRIPPED_REG_EXP, "")).match(PROTOCOL_REG_EXP)
  return match ? match[1].toLowerCase() + ":" : false
}

export function normalizeUrlProtocol(url: string): string {
  const protocol = matchUrlProtocolText(url)
  return protocol && !SKIP_PROTOCOLS.has(protocol) ? url : "https://" + url
}
