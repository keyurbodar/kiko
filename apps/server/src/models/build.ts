import type { Provider } from "@earendil-works/pi-ai"
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models"
import type { Catalog, CatalogModel, CatalogProvider, ConnectMethod } from "@kiko/protocol"

export function buildCatalog(all: readonly Provider[], signInMethod: (providerId: string) => ConnectMethod | undefined): Catalog {
  const providers: CatalogProvider[] = all.map((provider) => {
    const connect: ConnectMethod[] = []
    if (provider.auth?.apiKey) connect.push("api_key")
    const signIn = provider.auth?.oauth ? signInMethod(provider.id) : undefined
    if (signIn) connect.push(signIn)
    const oauth = provider.auth?.oauth
    const offer = signIn && oauth ? { method: signIn, label: oauth.loginLabel ?? oauth.name } : undefined
    const models: CatalogModel[] = [...provider.getModels()]
      .map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: Boolean(model.reasoning),
        thinking: getSupportedThinkingLevels(model),
        pricing: { input: model.cost?.input ?? 0, output: model.cost?.output ?? 0 },
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const classifiers = (provider.getAllModels?.() ?? []).filter((model) => model.type === "classifier").length
    return { id: provider.id, name: provider.name ?? provider.id, connect, ...(offer ? { signIn: offer } : {}), models, classifiers }
  })
  return { providers: providers.filter((p) => p.connect.length > 0).sort((a, b) => a.id.localeCompare(b.id)) }
}
