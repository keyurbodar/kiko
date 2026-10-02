import { createResource, createRoot } from "solid-js"
import { listProviders, type ProviderInfo } from "./credentials"

// One shared list of connected providers, so settings and the chat top bar agree.
// It holds provider ids and last four characters only.
const [providers, actions] = createRoot(() =>
  createResource<ProviderInfo[]>(
    async () => {
      try {
        return await listProviders()
      } catch {
        return []
      }
    },
    { initialValue: [] },
  ),
)

export const connectedProviders = (): ProviderInfo[] => providers() ?? []
export const refreshConnected = () => actions.refetch()
export const setConnected = actions.mutate
export const connectedReady = () => providers.state === "ready"
