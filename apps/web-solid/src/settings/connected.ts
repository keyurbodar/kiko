import type { ProviderInfo } from "@kiko/protocol"
import { useApp } from "../lib/store"

// The connected providers, so settings and the chat top bar agree. They are the user socket's
// provider rows: kept on this device, and changed on every device the moment a key is saved,
// removed, or stops working. Ids and last four characters only.

export const connectedProviders = (): ProviderInfo[] => useApp.rows("provider")

/** True once the server has answered on this connection, so an empty list means none. */
export const connectedReady = (): boolean => useApp.user()?.state.synced ?? false
