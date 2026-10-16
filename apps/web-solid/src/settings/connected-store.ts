import type { ProviderInfo } from "./credentials"

const storeKey = (userId: string) => `kiko:providers:${userId}`

export function readStored(userId: string): ProviderInfo[] {
  try {
    const list = JSON.parse(localStorage.getItem(storeKey(userId)) ?? "null")
    return Array.isArray(list) ? (list as ProviderInfo[]) : []
  } catch {
    return []
  }
}

export function writeStored(userId: string, list: ProviderInfo[]): void {
  try {
    localStorage.setItem(storeKey(userId), JSON.stringify(list))
  } catch {
    // storage can be blocked. the list still works for this page load.
  }
}
