/** True on a Mac, where Mod is ⌘ and Control is free for kiko's own keys. The same test as TanStack's `detectPlatform`, so the two agree on what Mod is. */
export const isMac = typeof navigator !== "undefined" && /mac/i.test(`${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`)
