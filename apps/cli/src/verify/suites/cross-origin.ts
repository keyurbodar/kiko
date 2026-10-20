// A page on another origin: the bearer token, the socket subprotocol, the file token, and CORS, all over a real
// socket and real HTTP with an Origin header the Worker does not share. Start the Worker with
//   bun run --cwd apps/server dev --port <n> --var TRUSTED_ORIGINS:https://app.example.test
// A server without that origin trusted makes the suite print a note and pass, so a sweep of every suite still runs.
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

const PAGE = process.env.KIKO_TRUSTED_ORIGIN ?? "https://app.example.test"
const STRANGER = "https://evil.example.test"

const suite: Suite = {
  name: "cross-origin",
  async run(v) {
    const api = (path: string) => new URL(path, v.url)
    const probe = await fetch(api("api/me"), { method: "OPTIONS", headers: { origin: PAGE, "access-control-request-method": "GET" } })
    if (probe.headers.get("access-control-allow-origin") !== PAGE) {
      console.log(`  skipped: ${PAGE} is not a trusted origin here. start the Worker with --var TRUSTED_ORIGINS:${PAGE}`)
      return
    }

    const s = await v.as("cross-origin")
    const token = s.auth.replace(/^Bearer /, "")

    const me = await fetch(api("api/me"), { headers: { authorization: s.auth, origin: PAGE } })
    expectEqual(me.status, 200, "GET /api/me with the bearer from the trusted page")
    expectEqual(me.headers.get("access-control-allow-origin"), PAGE, "allow-origin on the answer")
    expectEqual((await fetch(api("api/me"), { headers: { origin: PAGE } })).status, 401, "GET /api/me without the bearer")
    console.log("  ok bearer: accepted from the trusted page, refused without it")

    const pre = await fetch(api("api/files/home?path=a.txt"), {
      method: "OPTIONS",
      headers: { origin: PAGE, "access-control-request-method": "PUT", "access-control-request-headers": "authorization, content-type, x-kiko-if-sha256" },
    })
    expectEqual(pre.status, 204, "preflight status")
    expectEqual(pre.headers.get("access-control-allow-origin"), PAGE, "preflight allow-origin")
    const evil = await fetch(api("api/files/home?path=a.txt"), { method: "OPTIONS", headers: { origin: STRANGER, "access-control-request-method": "PUT" } })
    if (evil.headers.get("access-control-allow-origin")) throw new VerifyError("an untrusted origin got an allow-origin header")
    console.log("  ok cors: preflight allowed for the trusted origin, none for a stranger")

    const wsUrl = new URL("api/ws", v.url)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
    const connect = (protocols: string[], origin: string) =>
      new Promise<WebSocket | null>((resolve) => {
        const ws = new WebSocket(wsUrl, { protocols, headers: { origin } } as never)
        ws.onopen = () => resolve(ws)
        ws.onerror = () => resolve(null)
      })
    const ws = await connect(["kiko", token], PAGE)
    if (!ws) throw new VerifyError("the socket with a valid subprotocol token did not open")
    expectEqual(ws.protocol, "kiko", "the answer echoes the protocol")
    const fileToken = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new VerifyError("the hello reply carried no file token")), 5000)
      ws.onmessage = (ev) => {
        const frame = JSON.parse(String(ev.data)) as { fileToken?: string }
        if (frame.fileToken) {
          clearTimeout(timer)
          resolve(frame.fileToken)
        }
      }
      ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
    })
    ws.close()
    if (await connect(["kiko"], PAGE)) throw new VerifyError("a socket with no token opened")
    if (await connect(["kiko", token], STRANGER)) throw new VerifyError("a socket from an untrusted origin opened")
    console.log("  ok socket: opens with the subprotocol token and echoes it, refused without a token or from a stranger")

    const put = await s.putFile("home", `cross-origin-${Date.now()}.txt`, "bytes from another origin")
    expectEqual(put.status, 200, "upload with the bearer")
    const { file } = (await put.json()) as { file: { id: string } }
    const url = `api/files/home/${file.id}`
    const viaToken = await fetch(api(`${url}?t=${fileToken}`), { headers: { origin: PAGE } })
    expectEqual(await viaToken.text(), "bytes from another origin", "download with ?t=")
    expectEqual((await fetch(api(url))).status, 401, "download with no credential")
    expectEqual((await fetch(api(`api/me?t=${fileToken}`))).status, 401, "the file token on a non-download route")
    const up = await fetch(api("api/files/home?path=x.txt"), { method: "PUT", headers: { "x-kiko-if-sha256": "none", "content-type": "text/plain" }, body: "x" })
    expectEqual(up.status, 401, "upload with no bearer")
    const upByToken = await fetch(api(`api/files/home?path=x.txt&t=${fileToken}`), { method: "PUT", headers: { "x-kiko-if-sha256": "none", "content-type": "text/plain" }, body: "x" })
    expectEqual(upByToken.status, 401, "upload with the file token")
    console.log("  ok file token: reads a download and nothing else")
  },
}

export default suite
