import { createServer, type Server, type Socket } from "node:net"
import { randomBytes } from "node:crypto"

export interface Credential {
  readonly endpoint: string
  readonly authorization: string
}

export interface RelayServer {
  readonly address: string
  readonly token: string
  readonly credential: Promise<Credential>
  close(): Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCredentialLine = (
  value: unknown,
): value is { readonly token: string; readonly endpoint: string; readonly authorization: string } =>
  isRecord(value) &&
  typeof value.token === "string" &&
  typeof value.endpoint === "string" &&
  typeof value.authorization === "string"

export const startRelay = async (): Promise<RelayServer> => {
  const token = randomBytes(24).toString("hex")
  let resolveCredential: (credential: Credential) => void = () => undefined
  const credential = new Promise<Credential>((resolve) => {
    resolveCredential = resolve
  })
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding("utf8")
    let buffer = ""
    socket.on("data", (chunk: string) => {
      buffer += chunk
      const newline = buffer.indexOf("\n")
      if (newline < 0) return
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return
      }
      if (!isCredentialLine(parsed) || parsed.token !== token) return
      resolveCredential({ endpoint: parsed.endpoint, authorization: parsed.authorization })
    })
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    server.close()
    throw new Error("t3code relay did not bind a TCP port")
  }
  return {
    address: `127.0.0.1:${address.port}`,
    token,
    credential,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}
