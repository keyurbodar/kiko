import type { Api, Model, Provider } from "@earendil-works/pi-ai"
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models"
import type { Catalog, CatalogModel, CatalogProvider, ConnectMethod } from "@kiko/protocol"

const ALIAS = /\s*\(latest\)$/i

function listed<M extends Model<Api>>(models: readonly M[]): { model: M; name: string }[] {
  const aliased = new Set(models.filter((m) => ALIAS.test(m.name)).map((m) => m.name.replace(ALIAS, "")))
  return models.flatMap((model) =>
    ALIAS.test(model.name)
      ? [{ model, name: model.name.replace(ALIAS, "") }]
      : aliased.has(model.name)
        ? []
        : [{ model, name: model.name }],
  )
}

export function buildCatalog(
  all: readonly Provider[],
  signInMethod: (providerId: string) => ConnectMethod | undefined,
  custom: (providerId: string) => CatalogProvider["custom"] | undefined = () => undefined,
): Catalog {
  const providers: CatalogProvider[] = all.map((provider) => {
    const connect: ConnectMethod[] = []
    if (provider.auth?.apiKey) connect.push("api_key")
    const signIn = provider.auth?.oauth ? signInMethod(provider.id) : undefined
    if (signIn) connect.push(signIn)
    const oauth = provider.auth?.oauth
    const offer = signIn && oauth ? { method: signIn, label: oauth.loginLabel ?? oauth.name } : undefined
    const models: CatalogModel[] = listed(provider.getModels())
      .map(({ model, name }) => ({
        id: model.id,
        name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: Boolean(model.reasoning),
        thinking: getSupportedThinkingLevels(model),
        pricing: { input: model.cost?.input ?? 0, output: model.cost?.output ?? 0 },
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const classifiers = (provider.getAllModels?.() ?? []).filter((model) => model.type === "classifier").length
    return {
      id: provider.id,
      name: provider.name ?? provider.id,
      connect,
      ...(offer ? { signIn: offer } : {}),
      models,
      classifiers,
      ...(custom(provider.id) ? { custom: custom(provider.id)! } : {}),
    }
  })
  return { providers: providers.filter((p) => p.connect.length > 0).sort((a, b) => a.id.localeCompare(b.id)) }
}
