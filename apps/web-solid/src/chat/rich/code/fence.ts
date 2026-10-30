const TITLE_ATTR = /(?:^|\s)(?:title|file(?:name)?)=(?:"([^"]+)"|'([^']+)'|(\S+))/i

const FILENAME_TOKEN = /^[\w@][\w@./-]*\.[A-Za-z0-9]+$/

export function extractFenceTitle(meta: string | undefined): string | null {
  if (!meta) return null
  const match = TITLE_ATTR.exec(meta)
  const attr = match?.[1] ?? match?.[2] ?? match?.[3]
  if (attr) return attr
  return meta.split(/\s+/).find((part) => FILENAME_TOKEN.test(part)) ?? null
}
