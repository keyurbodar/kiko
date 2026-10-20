import { fileName, linkTarget } from "@kiko/protocol"

export function fileRefToken(path: string, folder = false): string {
  const clean = path.replace(/\/+$/, "")
  return `[${fileName(clean).replace(/[[\]\n\\]/g, "")}](${linkTarget(`/${clean}${folder ? "/" : ""}`)})`
}
