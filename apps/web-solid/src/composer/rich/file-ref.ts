import { fileName, linkTarget } from "@kiko/protocol"

const UPLOAD_STAMP = /^attachments\/[0-9a-z]{6,10}-(?=.)/

export function shownName(path: string): string {
  const clean = path.replace(/\/+$/, "")
  return UPLOAD_STAMP.test(clean) ? fileName(clean.replace(UPLOAD_STAMP, "")) : fileName(clean)
}

export function fileRefToken(path: string, folder = false): string {
  const clean = path.replace(/\/+$/, "")
  return `[${shownName(clean).replace(/[[\]\n\\]/g, "")}](${linkTarget(`/${clean}${folder ? "/" : ""}`)})`
}

const LINK = /!?\[([^\]\n]*)\]\((?:<[^>\n]*>|[^)\n]*)\)/g

export function draftPreview(text: string): string {
  return text.replace(LINK, "$1").trim()
}
