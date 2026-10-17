import type { UserToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"


const FAKE = "kiko-fake"
const CODE = "KIKO-0000"

type Frame<T extends UserToClient["t"]> = Extract<UserToClient, { t: T }>

const suite: Suite = {
  name: "provider-login",
  async run(v) {
    const base = v.url
    const s = await v.as("provider-login-alice")
    const credentials = async (method = "GET", path = "") => {
      const res = await fetch(new URL(`api/credentials${path}`, base), {
        method,
        headers: { authorization: s.auth },
        signal: AbortSignal.timeout(5000),
      })
      return (await res.json()) as { providers: { provider: string }[] }
    }
    let n = 0
    const id = () => `login-${Date.now()}-${++n}`
    const user = await s.user()
    const ofLogin = <T extends UserToClient["t"]>(t: T, loginId: string) => (f: UserToClient) =>
      f.t === t && (f as { loginId?: string }).loginId === loginId

    const refused = id()
    user.send({ t: "login.start", loginId: refused, provider: "openrouter" })
    const unsupported = (await user.expect(ofLogin("login.error", refused))) as Frame<"login.error">
    expectEqual(unsupported.reason, "unsupported", "openrouter sign-in")
    const stray = id()
    user.send({ t: "login.cancel", loginId: stray })
    expectEqual(((await user.expect(ofLogin("login.error", stray))) as Frame<"login.error">).reason, "unknown", "cancel of no login")

    const hostIds: (string | null)[] = []
    for (let round = 0; round < 2; round++) {
      const chatgpt = id()
      user.send({ t: "login.start", loginId: chatgpt, provider: "openai" })
      const opened = (await user.expect(ofLogin("login.notify", chatgpt))) as Frame<"login.notify">
      if (opened.event.type !== "auth_url") throw new VerifyError(`expected an auth_url, got ${opened.event.type}`)
      const authorize = new URL(opened.event.url)
      expectEqual(authorize.searchParams.get("code_challenge_method"), "S256", "ChatGPT sign-in PKCE method")
      hostIds.push(authorize.searchParams.get("ext_agent_host_id"))
      const paste = (await user.expect(ofLogin("login.prompt", chatgpt))) as Frame<"login.prompt">
      expectEqual(paste.prompt.type, "manual_code", "ChatGPT sign-in prompt type")
      user.send({
        t: "login.answer",
        loginId: chatgpt,
        promptId: paste.promptId,
        value: "http://127.0.0.1:1455/auth/callback?code=x&state=another&client_id=app",
      })
      const mismatch = (await user.expect(ofLogin("login.error", chatgpt))) as Frame<"login.error">
      expectEqual(
        mismatch.message.startsWith("That address does not match this sign-in. Start again and paste the address from the same tab."),
        true,
        "ChatGPT sign-in state mismatch sentence",
      )
    }
    if (!hostIds[0]?.startsWith("urn:uuid:") || hostIds[0] !== hostIds[1]) throw new VerifyError(`the ChatGPT host id is not stable: ${hostIds.join(" ")}`)

    if (!v.fake) {
      console.log("  provider-login: run with --fake for the sign-in flow itself")
      return
    }
    await credentials("DELETE", `/${FAKE}`)

    const good = id()
    user.send({ t: "login.start", loginId: good, provider: FAKE })
    const notify = (await user.expect(ofLogin("login.notify", good))) as Frame<"login.notify">
    if (notify.event.type !== "device_code" || notify.event.userCode !== CODE) {
      throw new VerifyError(`expected the fake device code, got ${JSON.stringify(notify.event)}`)
    }
    const prompt = (await user.expect(ofLogin("login.prompt", good))) as Frame<"login.prompt">
    expectEqual(prompt.prompt.type, "manual_code", "prompt type")
    user.send({ t: "login.answer", loginId: good, promptId: prompt.promptId, value: CODE })
    const done = (await user.expect(ofLogin("login.done", good))) as Frame<"login.done">
    expectEqual(done.provider, { provider: FAKE, kind: "oauth", last4: "" }, "login.done provider")
    const listed = (await credentials()).providers.find((p) => p.provider === FAKE)
    expectEqual(listed, { provider: FAKE, kind: "oauth", last4: "", chat: false, judge: false }, "the stored row")
    expectEqual(await credentials("DELETE", `/${FAKE}`), { removed: true }, "disconnect")

    const wrong = id()
    user.send({ t: "login.start", loginId: wrong, provider: FAKE })
    const wrongPrompt = (await user.expect(ofLogin("login.prompt", wrong))) as Frame<"login.prompt">
    user.send({ t: "login.answer", loginId: wrong, promptId: wrongPrompt.promptId, value: "nope" })
    const failed = (await user.expect(ofLogin("login.error", wrong))) as Frame<"login.error">
    expectEqual(failed.reason, "failed", "wrong code")
    expectEqual((await credentials()).providers, [], "providers after a wrong code")

    const cancelled = id()
    user.send({ t: "login.start", loginId: cancelled, provider: FAKE })
    const cancelPrompt = (await user.expect(ofLogin("login.prompt", cancelled))) as Frame<"login.prompt">
    user.send({ t: "login.cancel", loginId: cancelled })
    expectEqual(((await user.expect(ofLogin("login.error", cancelled))) as Frame<"login.error">).reason, "cancelled", "cancel")
    user.send({ t: "login.answer", loginId: cancelled, promptId: cancelPrompt.promptId, value: CODE })
    expectEqual(((await user.expect(ofLogin("login.error", cancelled))) as Frame<"login.error">).reason, "unknown", "answer after cancel")

    const abandoned = id()
    user.send({ t: "login.start", loginId: abandoned, provider: FAKE })
    await user.expect(ofLogin("login.prompt", abandoned))
    await user.reconnect()
    await new Promise((r) => setTimeout(r, 200))
    user.send({ t: "login.start", loginId: abandoned, provider: FAKE })
    const again = await user.expect(
      (f) => (f.t === "login.prompt" || f.t === "login.error") && (f as { loginId?: string }).loginId === abandoned,
    )
    if (again.t !== "login.prompt") throw new VerifyError(`the abandoned login was still held: ${JSON.stringify(again)}`)
    user.send({ t: "login.cancel", loginId: abandoned })
    expectEqual(((await user.expect(ofLogin("login.error", abandoned))) as Frame<"login.error">).reason, "cancelled", "cancel after restart")
    expectEqual((await credentials()).providers, [], "providers after an abandoned login")
  },
}

export default suite
