import type { UserToClient } from "@yuki/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// P4-04. Provider sign-in over the user socket. Without `--fake` it checks only the
// refusals. With `--fake` it runs the development server's fake provider, whose flow
// sends a device code (`notify`) and asks for it back (`prompt`): a right code stores
// an OAuth credential, a wrong code fails, and an abandoned login is gone for good.

const FAKE = "yuki-fake"
const CODE = "YUKI-0000"

type Frame<T extends UserToClient["t"]> = Extract<UserToClient, { t: T }>

const suite: Suite = {
  name: "provider-login",
  async run(v) {
    const base = v.url.endsWith("/") ? v.url : `${v.url}/`
    const s = await v.as("provider-login-alice")
    const credentials = async (method = "GET", path = "") => {
      const res = await fetch(new URL(`api/credentials${path}`, base), {
        method,
        headers: { cookie: s.cookie },
        signal: AbortSignal.timeout(5000),
      })
      return (await res.json()) as any
    }
    let n = 0
    const id = () => `login-${Date.now()}-${++n}`
    const user = await s.user()
    const ofLogin = <T extends UserToClient["t"]>(t: T, loginId: string) => (f: UserToClient) =>
      f.t === t && (f as { loginId?: string }).loginId === loginId

    // Refusals. OpenRouter's flow needs a loopback server, so yuki does not run it.
    const refused = id()
    user.send({ t: "login.start", loginId: refused, provider: "openrouter" })
    const unsupported = (await user.expect(ofLogin("login.error", refused))) as Frame<"login.error">
    expectEqual(unsupported.reason, "unsupported", "openrouter sign-in")
    const stray = id()
    user.send({ t: "login.cancel", loginId: stray })
    expectEqual(((await user.expect(ofLogin("login.error", stray))) as Frame<"login.error">).reason, "unknown", "cancel of no login")

    if (!v.fake) {
      console.log("  provider-login: run with --fake for the sign-in flow itself")
      return
    }
    await credentials("DELETE", `/${FAKE}`)

    // 1. The full flow: notify, prompt, answer, stored.
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
    const listed = (await credentials()).providers.find((p: { provider: string }) => p.provider === FAKE)
    expectEqual(listed, { provider: FAKE, kind: "oauth", last4: "" }, "the stored row")
    expectEqual(await credentials("DELETE", `/${FAKE}`), { removed: true }, "disconnect")

    // 2. A wrong code fails and stores nothing.
    const wrong = id()
    user.send({ t: "login.start", loginId: wrong, provider: FAKE })
    const wrongPrompt = (await user.expect(ofLogin("login.prompt", wrong))) as Frame<"login.prompt">
    user.send({ t: "login.answer", loginId: wrong, promptId: wrongPrompt.promptId, value: "nope" })
    const failed = (await user.expect(ofLogin("login.error", wrong))) as Frame<"login.error">
    expectEqual(failed.reason, "failed", "wrong code")
    expectEqual((await credentials()).providers, [], "providers after a wrong code")

    // 3. Cancel.
    const cancelled = id()
    user.send({ t: "login.start", loginId: cancelled, provider: FAKE })
    const cancelPrompt = (await user.expect(ofLogin("login.prompt", cancelled))) as Frame<"login.prompt">
    user.send({ t: "login.cancel", loginId: cancelled })
    expectEqual(((await user.expect(ofLogin("login.error", cancelled))) as Frame<"login.error">).reason, "cancelled", "cancel")
    user.send({ t: "login.answer", loginId: cancelled, promptId: cancelPrompt.promptId, value: CODE })
    expectEqual(((await user.expect(ofLogin("login.error", cancelled))) as Frame<"login.error">).reason, "unknown", "answer after cancel")

    // 4. Abandoned: the socket closes mid-login. The server keeps no state for it: the
    // same login id starts afresh from a new socket instead of being refused as still
    // running, and nothing was stored.
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
