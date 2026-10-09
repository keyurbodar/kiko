import type { ClientToUser, ExecutorResult, ExecutorStatus } from "@yuki/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// P7-03. Connects a real Executor Cloud (v2) account over the user socket, lists its tools,
// forces a token refresh, disconnects, and sees every row gone.
//
// Part one needs no account: the sign-in starts, the authorize URL carries PKCE S256,
// `offline_access`, and this server's callback, and Executor's sign-in page answers it.
// Part two needs a human to sign in once in a browser. Set YUKI_EXECUTOR_WAIT to the
// seconds the suite should wait for that. `.cursor/skills/verify-kiko-server` has the steps.

const USER = "executor-alice"
const CALLBACK = "api/integrations/executor/callback"
const AUTHORIZE = "https://v2.executor.sh/api/auth/oauth2/authorize"

type Frame = Extract<ClientToUser, { t: "connectExecutor" | "disconnectExecutor" | "executorStatus" }>
type Ask = Frame extends infer F ? (F extends Frame ? Omit<F, "reqId"> : never) : never

function ok(result: ExecutorResult, what: string) {
  if (!result.ok) throw new VerifyError(`${what} failed: ${result.error}`)
  return result
}

const suite: Suite = {
  name: "executor-connect",
  human: true,
  async run(v) {
    const base = v.url.endsWith("/") ? v.url : `${v.url}/`
    const s = await v.as(USER)
    const user = await s.user()
    let n = 0
    const ask = async (frame: Ask, timeout = 30_000): Promise<ExecutorResult> => {
      const reqId = `x${++n}`
      user.send({ ...frame, reqId } as ClientToUser)
      const answer = await user.expect((f) => f.t === "executor" && f.reqId === reqId, timeout)
      return (answer as { result: ExecutorResult }).result
    }

    let status: ExecutorStatus = ok(await ask({ t: "executorStatus" }), "status").status
    if (!status.connected || status.kind !== "oauth") {
      const started = ok(await ask({ t: "connectExecutor" }), "connect")
      if (!started.authorizeUrl) throw new VerifyError("connect returned no authorize url")
      const url = new URL(started.authorizeUrl)
      expectEqual(`${url.origin}${url.pathname}`, AUTHORIZE, "authorize endpoint")
      expectEqual(url.searchParams.get("code_challenge_method"), "S256", "pkce method")
      expectEqual(url.searchParams.get("redirect_uri"), new URL(CALLBACK, base).href, "redirect uri")
      expectEqual(url.searchParams.get("resource"), "https://v2.executor.sh/mcp", "resource")
      if (!url.searchParams.get("scope")?.split(" ").includes("offline_access")) throw new VerifyError("scope lacks offline_access")
      expectEqual(started.status.pending, true, "a sign-in is pending")

      // Executor's sign-in server must accept the request and send the browser to its sign-in
      // page, not back to the callback with an error.
      const page = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) })
      const next = page.headers.get("location") ?? ""
      if (page.status >= 400 || next.startsWith(new URL(CALLBACK, base).href)) {
        throw new VerifyError(`executor refused the authorize request: ${page.status} ${next.slice(0, 200)}`)
      }
      console.error(`executor sign-in page reached (${page.status}${next ? ` -> ${new URL(next, url).origin}` : ""})`)

      const wait = Number(process.env.YUKI_EXECUTOR_WAIT ?? 0)
      const steps = [
        "waiting on a human. in one browser:",
        `  1. open ${new URL(`api/auth/dev/session?name=${USER}`, base).href}`,
        `  2. open ${started.authorizeUrl}`,
        "  3. sign in to executor and approve yuki",
      ].join("\n")
      if (!wait) throw new VerifyError(`${steps}\nrerun with YUKI_EXECUTOR_WAIT=300 and do the steps while it waits`)
      console.error(steps)
      const told = await user.expect((f) => f.t === "executor" && f.reqId === undefined, wait * 1000)
      const result = (told as { result: ExecutorResult }).result
      status = ok(result, "the sign-in").status
    }
    expectEqual([status.connected, status.kind], [true, "oauth"], "connected with oauth")

    const listed = ok(await ask({ t: "executorStatus", tools: true }), "tools/list")
    if (!listed.tools?.length) throw new VerifyError("tools/list returned no tools")
    console.error(`tools: ${listed.tools.join(", ")}`)
    console.error(`token lifetime: ${status.expiresAt && status.issuedAt ? Math.round((status.expiresAt - status.issuedAt) / 1000) : "unknown"}s`)

    if (!status.refreshable) throw new VerifyError("executor gave no refresh token, so the connection cannot stay fresh")
    const refreshed = ok(await ask({ t: "executorStatus", refresh: true, tools: true }), "refresh")
    if (!(refreshed.status.issuedAt! > status.issuedAt!)) throw new VerifyError("the refresh did not issue a new access token")
    if (!refreshed.tools?.length) throw new VerifyError("tools/list failed after the refresh")

    const gone = ok(await ask({ t: "disconnectExecutor" }), "disconnect")
    expectEqual([gone.status.connected, gone.status.rows], [false, 0], "connected and rows after disconnect")
    const after = await ask({ t: "executorStatus", tools: true })
    expectEqual(after, { ok: false, error: "executor is not connected" }, "tools/list after disconnect")

    // A second user never sees the first user's connection.
    const bob = await (await v.as("executor-bob")).user()
    bob.send({ t: "executorStatus", reqId: "b1" })
    const theirs = (await bob.expect((f) => f.t === "executor" && f.reqId === "b1")) as { result: ExecutorResult }
    expectEqual(ok(theirs.result, "bob's status").status.rows, 0, "bob's executor rows")
  },
}

export default suite
