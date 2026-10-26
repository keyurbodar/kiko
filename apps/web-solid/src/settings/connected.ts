import type { ProviderInfo } from "@kiko/protocol"
import { user } from "../state/user"

export const connectedProviders = (): ProviderInfo[] => user.rows("provider")

export const connectedReady = (): boolean => user.synced() ?? false
