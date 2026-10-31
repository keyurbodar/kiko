import { userInfo } from "node:os"
import type { Machine, Task } from "../../types"
import {
  at,
  bun,
  check,
  LIMITS,
  mulberry32,
  readText,
  run,
  spawnTracked,
  verdict,
  waitForFile,
  writeJson,
  writeText,
} from "../helpers"

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const tokenFor = (seed: number): string => `secret-${hex(mulberry32(seed), 24)}`

const config = (m: Machine, port: number): string => `Port ${port}
ListenAddress 127.0.0.1
HostKey ${at(m, "hostkey")}
AuthorizedKeysFile ${at(m, "authorized_keys")}
StrictModes no
UsePAM no
PasswordAuthentication no
KbdInteractiveAuthentication no
PidFile ${at(m, "sshd.pid")}
LogLevel QUIET
SetEnv HOME=${m.workdir}
ForceCommand cd ${m.workdir} && exec /bin/sh -c "$SSH_ORIGINAL_COMMAND"
`

const freePort = async (m: Machine): Promise<number> => {
  const result = await bun(
    m,
    'const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })\nconsole.log(listener.port)\nlistener.stop(true)',
  )
  const port = Number(result.stdout.trim())
  if (!Number.isInteger(port) || port <= 0) throw new Error(`could not find a free port: ${result.stderr}`)
  return port
}

const startSshd = async (m: Machine): Promise<void> => {
  const args = ["-f", at(m, "sshd_config"), "-D", "-E", at(m, "sshd.log")]
  if (m.os === "macos") await spawnTracked(m, ["sudo", "-n", "/usr/sbin/sshd", ...args])
  else await spawnTracked(m, ["/usr/sbin/sshd", ...args])
}

const field = (text: string, key: string): string | undefined => new RegExp(`^${key} (\\S+)$`, "m").exec(text)?.[1]

export const sshLocalhost: Task = {
  id: "terminal-011-ssh-localhost",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "Connect to the local SSH server described in host.txt with the key in clientkey, read the file secret.txt in the home directory, and write its contents to answer.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    const port = await freePort(m)
    await run(m, ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", "hostkey"])
    await run(m, ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", "clientkey"])
    const publicKey = (await readText(m, "clientkey.pub"))?.trim() ?? ""
    await writeText(m, "authorized_keys", `${publicKey}\n`)
    await writeText(m, "secret.txt", `${tokenFor(seed)}\n`)
    await writeText(m, "host.txt", `port ${port}\nuser ${userInfo().username}\n`)
    await writeText(m, "sshd_config", config(m, port))
    await startSshd(m)
    await waitForFile(m, "sshd.pid")
  },
  oracle: async (m) => {
    const host = (await readText(m, "host.txt")) ?? ""
    const port = field(host, "port")
    const user = field(host, "user")
    if (!port || !user) throw new Error("host.txt is missing the port or user")
    await run(m, [
      "bash",
      "-c",
      `ssh -p ${port} -i clientkey -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${user}@127.0.0.1 "cat secret.txt" > answer.txt`,
    ])
  },
  check: async (m, seed) => {
    const token = tokenFor(seed)
    const answer = await readText(m, "answer.txt")
    return verdict([check("answer matches", answer?.trim() === token, `answer.txt was ${JSON.stringify(answer)}`)])
  },
}
