// The backend says what build it is, in two places: GET /api/version and the first reply to `hello`.
// Both must carry a version and the protocol number, and they must match each other.
import { PROTOCOL } from "@kiko/protocol"
import { ClientToUser, UserToClient as UserToClientSchema } from "@kiko/protocol/schema"
import { Channel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

const suite: Suite = {
  name: "versions",
  async run(v) {
    const res = await fetch(new URL("api/version", v.url))
    if (!res.ok) throw new VerifyError(`GET /api/version answered ${res.status}`)
    const http = (await res.json()) as { version?: unknown; protocol?: unknown }
    if (typeof http.version !== "string" || !http.version) throw new VerifyError(`/api/version has no version: ${JSON.stringify(http)}`)
    if (typeof http.protocol !== "number") throw new VerifyError(`/api/version has no protocol: ${JSON.stringify(http)}`)
    expectEqual(http.protocol, PROTOCOL, "/api/version protocol")

    const s = await v.as("versions")
    const wsUrl = new URL("api/ws/user", v.url)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
    const user = new Channel(`${s.name}/user hello`, wsUrl, s.cookie, UserToClientSchema, ClientToUser, { t: "hello", lastSeq: 0 })
    try {
      await user.connect()
      const first = await user.expect(() => true)
      if (first.t !== "events" && first.t !== "reset") throw new VerifyError(`hello must answer with events or reset, got ${first.t}`)
      expectEqual(first.version, http.version, "hello version matches /api/version")
      expectEqual(first.protocol, PROTOCOL, "hello protocol")
    } finally {
      user.close()
    }
  },
}

export default suite
