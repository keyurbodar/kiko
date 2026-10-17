import { KIKO } from "@kiko/protocol"
import type { AgentSlug, Catalog, UserEvent, UserToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

const PROVIDER = "opencode-go"
const MODEL_ID = `verify-live-${Date.now().toString(36)}`

const modelEvents = (frame: UserToClient): Extract<UserEvent, { t: "agent_model" }>[] =>
  frame.t === "events" ? frame.events.filter((e): e is Extract<UserEvent, { t: "agent_model" }> => e.t === "agent_model") : []

const suite: Suite = {
  name: "models-sync",
  async run(v) {
    const s = await v.as("models-sync")

    const get = (headers: Record<string, string> = {}, auth: string | null = s.auth) =>
      fetch(new URL("api/models", v.url), { headers: { ...(auth ? { authorization: auth } : {}), ...headers }, signal: AbortSignal.timeout(15_000) })
    const install = async (models: { id: string; name: string }[]) => {
      const res = await fetch(new URL("api/dev/user/model-overlay", v.url), {
        method: "POST",
        headers: { authorization: s.auth, "content-type": "application/json" },
        body: JSON.stringify({ provider: PROVIDER, models }),
      })
      expectEqual(res.status, 200, "status of the dev overlay install")
    }
    const idsOf = (catalog: Catalog) => catalog.providers.find((p) => p.id === PROVIDER)?.models.map((m) => m.id) ?? []

    expectEqual((await get({}, null)).status, 401, "status without a session")

    await install([])
    const first = await get()
    expectEqual(first.status, 200, "status of the catalog")
    const catalog = (await first.json()) as Catalog
    if (catalog.providers.length < 10) throw new VerifyError(`the catalog lists ${catalog.providers.length} providers`)
    if (!idsOf(catalog).length) throw new VerifyError(`${PROVIDER} lists no models`)
    expectEqual(catalog.providers.find((p) => p.id === PROVIDER)?.connect, ["api_key"], "connect methods of a key-only provider")
    if (!catalog.providers.find((p) => p.id === "anthropic")?.connect.includes("paste_code")) throw new VerifyError("anthropic does not offer paste_code")
    if (!catalog.providers.find((p) => p.id === "github-copilot")?.connect.includes("device_code")) throw new VerifyError("github-copilot does not offer device_code")
    const openrouter = catalog.providers.find((p) => p.id === "openrouter")?.connect ?? []
    if (openrouter.some((m) => m !== "api_key")) throw new VerifyError(`openrouter offers a sign-in the server refuses: ${openrouter}`)

    const etag = first.headers.get("etag")
    if (!etag) throw new VerifyError("the catalog has no etag")
    expectEqual(first.headers.get("cache-control"), "no-cache", "cache-control")
    const again = await get({ "if-none-match": etag })
    expectEqual([again.status, again.headers.get("etag")], [304, etag], "revalidation with the etag")
    expectEqual((await get({ "if-none-match": etag.replace(/-[^-"]*"$/, '-0.0.0"') })).status, 200, "an etag from another build")

    const a = await s.user()
    await a.expect(() => true)
    try {
      await install([{ id: MODEL_ID, name: "Verify live model" }])
      await a.expect((f) => f.t === "changed" && f.what === "models")
      const next = await get({ "if-none-match": etag })
      expectEqual(next.status, 200, "status after a new model appears")
      if (next.headers.get("etag") === etag) throw new VerifyError("the etag did not change with the catalog")
      if (!idsOf((await next.json()) as Catalog).includes(MODEL_ID)) throw new VerifyError("the new model is not in the catalog")

      const ref = `${PROVIDER}/${MODEL_ID}`
      a.send({ t: "agent_model", slug: KIKO as AgentSlug, ref })
      const set = modelEvents(await a.expect((f) => modelEvents(f).some((e) => e.slug === KIKO && e.model === ref))).find((e) => e.model === ref)
      expectEqual(set?.model, ref, "Kiko's model after picking the live model")
    } finally {
      await install([])
    }
    if (idsOf((await (await get()).json()) as Catalog).includes(MODEL_ID)) throw new VerifyError("the model stayed after the overlay was cleared")
  },
}

export default suite
