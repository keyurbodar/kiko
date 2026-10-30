import { avatar, type AvatarOptions } from "./index"

const LIMIT = 256
const cache = new Map<string, string>()

function avatarUri(name: string, options: AvatarOptions = {}): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(avatar(name, options))
}

export function cachedUri(name: string, options: AvatarOptions = {}): string {
  const key = JSON.stringify([name, options])
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const uri = avatarUri(name, options)
  if (cache.size >= LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, uri)
  return uri
}
