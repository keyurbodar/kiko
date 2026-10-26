import type { ProviderInfo } from "@kiko/protocol"
import { call, owner } from "../state/runtime"

export type { ProviderInfo }

export const connectProvider = (provider: string, apiKey: string): Promise<ProviderInfo> =>
  call(owner.commands.credentialsConnect, { provider, apiKey }, "Kiko could not save that key.")

export const disconnectProvider = (provider: string): Promise<void> =>
  call(owner.commands.credentialsDisconnect, { provider })

export const checkProvider = (provider: string): Promise<ProviderInfo> =>
  call(owner.commands.credentialsCheck, { provider })
