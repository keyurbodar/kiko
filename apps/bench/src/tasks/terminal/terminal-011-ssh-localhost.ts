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
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PidFile ${at(m, "sshd.pid")}
LogLevel ERROR
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

const SSHD_PATHS = ["/usr/sbin/sshd", "/usr/bin/sshd", "/sbin/sshd", "/run/current-system/sw/bin/sshd"]

const sshdPath = async (m: Machine): Promise<string> => {
  const found = await run(m, ["bash", "-c", "command -v sshd 2>/dev/null || true"])
  const fromPath = found.stdout.trim()
  if (fromPath) return fromPath
  for (const candidate of SSHD_PATHS) {
    const check = await run(m, ["bash", "-c", `test -x ${candidate}`])
    if (check.code === 0) return candidate
  }
  throw new Error("sshd is not installed")
}

const startSshd = async (m: Machine): Promise<void> => {
  const args = ["-f", at(m, "sshd_config"), "-D", "-E", at(m, "sshd.log")]
  const sshd = await sshdPath(m)
  if (m.os === "macos") await spawnTracked(m, ["sudo", "-n", sshd, ...args])
  else await spawnTracked(m, [sshd, ...args])
}

const field = (text: string, key: string): string | undefined => new RegExp(`^${key} (\\S+)$`, "m").exec(text)?.[1]

const loginName = async (m: Machine): Promise<string> => {
  const who = await run(m, ["id", "-un"])
  const name = who.stdout.trim()
  return who.code === 0 && name !== "" ? name : userInfo().username
}

const tail = (text: string | undefined): string => (text ?? "").trim().split("\n").slice(-5).join(" | ")

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
    const hostKey = await run(m, ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", "hostkey"])
    if (hostKey.code !== 0) throw new Error(`ssh-keygen could not make the host key: ${hostKey.stderr}`)
    const clientKey = await run(m, ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", "clientkey"])
    if (clientKey.code !== 0) throw new Error(`ssh-keygen could not make the client key: ${clientKey.stderr}`)
    const publicKey = (await readText(m, "clientkey.pub"))?.trim() ?? ""
    if (publicKey === "") throw new Error("ssh-keygen wrote no public key for clientkey")
    await writeText(m, "authorized_keys", `${publicKey}\n`)
    await writeText(m, "secret.txt", `${tokenFor(seed)}\n`)
    await writeText(m, "host.txt", `port ${port}\nuser ${await loginName(m)}\n`)
    await writeText(m, "sshd_config", config(m, port))
    await startSshd(m)
    await waitForFile(m, "sshd.pid")
  },
  oracle: async (m) => {
    const host = (await readText(m, "host.txt")) ?? ""
    const port = field(host, "port")
    const user = field(host, "user")
    if (!port || !user) throw new Error("host.txt is missing the port or user")
    const result = await run(m, [
      "bash",
      "-c",
      `ssh -p ${port} -i clientkey -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=10 ${user}@127.0.0.1 "cat secret.txt" > answer.txt 2> ssh.err`,
    ])
    if (result.code !== 0) {
      const said = (await readText(m, "ssh.err"))?.trim() ?? ""
      const server = tail(await readText(m, "sshd.log"))
      const spawn = tail(await readText(m, ".spawn.log"))
      throw new Error(
        `the ssh client exited ${result.code}: ${said}${server ? `; sshd said ${server}` : ""}${spawn ? `; spawn said ${spawn}` : ""}`,
      )
    }
  },
  check: async (m, seed) => {
    const token = tokenFor(seed)
    const answer = await readText(m, "answer.txt")
    const said = (await readText(m, "ssh.err"))?.trim() ?? ""
    const detail = `answer.txt was ${JSON.stringify(answer)}${said ? `; ssh said ${JSON.stringify(said)}` : ""}`
    return verdict([check("answer matches", answer?.trim() === token, detail)])
  },
}
