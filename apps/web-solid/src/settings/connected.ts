import type { ProviderInfo } from "@kiko/protocol"
import { useApp } from "../lib/store"

export const connectedProviders = (): ProviderInfo[] => useApp.rows("provider")

export const connectedReady = (): boolean => useApp.user()?.state.synced ?? false
