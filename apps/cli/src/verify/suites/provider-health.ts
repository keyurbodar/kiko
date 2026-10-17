import type { ProviderInfo, UserToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

const FAKE = "kiko-fake"
const CODE = "KIKO-0000"

type Frame<T extends UserToClient["t"]> = Extract<UserToClient, { t: T }>

// DEVELOPMENT SERVER ONLY. The sign-in test provider's token refresh is switched through a dev route, so the suite
// can show a revoked sign-in, an outage, and the check that clears it, with no model key.
const suite: Suite = {
  name: "provider-health",
  async run(v) {
    const s = await v.as("provider-health-alice")
    const api = (path: string, method = "GET", body?: unknown) =>
      fetch(new URL(path, v.url), {
        method,
        headers: { authorization: s.auth, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      })
    const row = async () => ((await (await api("api/credentials")).json()) as { providers: ProviderInfo[] }).providers.find((p) => p.provider === FAKE)
    const refresh = async (mode: "fail" | "offline" | "ok", wake = false) => {
      const res = await api("api/dev/user/provider-health", "POST", { refresh: mode, wake })
      expectEqual(res.status, 200, `dev provider-health ${mode}`)
    }
    const check = async () => {
      const res = await api(`api/credentials/${FAKE}/check`, "POST")
      expectEqual(res.status, 200, "status of the check")
      return ((await res.json()) as { provider: ProviderInfo }).provider
    }
    const changed = (f: UserToClient) => f.t === "changed" && f.what === "providers"

    const user = await s.user()
    await api(`api/credentials/${FAKE}`, "DELETE")
    await refresh("ok")

    const loginId = `health-${Date.now()}`
    user.send({ t: "login.start", loginId, provider: FAKE })
    const prompt = (await user.expect((f) => f.t === "login.prompt" && f.loginId === loginId)) as Frame<"login.prompt">
    user.send({ t: "login.answer", loginId, promptId: prompt.promptId, value: CODE })
    await user.expect((f) => f.t === "login.done" && f.loginId === loginId)
    expectEqual((await row())?.problem, undefined, "a fresh sign-in has no problem")

    await refresh("fail", true)
    await user.expect(changed)
    const found = await row()
    expectEqual(found?.problem, "signed_out", "the six-hourly refresh finds a revoked sign-in")
    if (!found?.problemAt) throw new VerifyError("the problem has no time")

    expectEqual((await check()).problem, "signed_out", "a check while the refresh is still refused")
    await refresh("offline")
    expectEqual((await check()).problem, "signed_out", "an outage does not clear the problem")
    expectEqual((await row())?.problem, "signed_out", "the row after the outage")

    await refresh("ok")
    const cleared = await check()
    expectEqual(cleared.problem, undefined, "the check after the refresh works again")
    await user.expect(changed)
    expectEqual((await row())?.problem, undefined, "the row after the check")

    await refresh("offline", true)
    expectEqual((await row())?.problem, undefined, "an outage during the refresh sets no problem")
    await refresh("ok")

    expectEqual((await api("api/credentials/nobody/check", "POST")).status, 404, "check of a provider that is not connected")
    expectEqual((await api(`api/credentials/${FAKE}/check`)).status, 405, "check by GET")
    expectEqual((await api("api/credentials/Bad..Id/check", "POST")).status, 400, "check of a bad provider id")
    await api(`api/credentials/${FAKE}`, "DELETE")
  },
}

export default suite
