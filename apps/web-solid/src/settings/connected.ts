import { createResource, createRoot } from "solid-js"
import { session } from "../app/session"
import { listProviders, type ProviderInfo } from "./credentials"
import { hasModelProvider } from "./provider-kinds"
import { watchChanged } from "../sync/changed"
import { readStored, writeStored } from "./connected-store"

// One shared list of connected providers, so settings and the chat top bar agree.
// It holds provider ids and last four characters only. It is keyed by the signed-in user, so a list
// fetched before sign-in (an empty 401) never sticks, and it refreshes when the tab comes back, so a
// key connected in another tab or from the CLI shows up without a reload. The last list is kept
// on this device, so a reload paints the connected providers at once instead of an empty list.
function initialList(): ProviderInfo[] {
  const s = session()
  return s.status === "signed-in" ? readStored(s.user.id) : []
}

const [providers, actions] = createRoot(() => {
  const res = createResource<ProviderInfo[], string>(
    () => {
      const s = session()
      return s.status === "signed-in" ? s.user.id : false
    },
    async (userId) => {
      try {
        const list = await listProviders()
        writeStored(userId, list)
        return list
      } catch {
        return readStored(userId)
      }
    },
    { initialValue: initialList() },
  )
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && session().status === "signed-in") void res[1].refetch()
    })
  }
  watchChanged("providers", () => res[1].refetch())
  return res
})

export const connectedProviders = (): ProviderInfo[] => providers() ?? []
export const refreshConnected = () => actions.refetch()
export const connectedReady = () => providers.state === "ready"
