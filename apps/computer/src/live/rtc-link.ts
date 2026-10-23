import type { IceServer } from "@kiko/computer/wire"

export type PeerModule = typeof import("node-datachannel")

export type RtcConfig = { iceServers: (string | TurnServer)[] }

type TurnServer = {
  hostname: string
  port: number
  username?: string
  password?: string
  relayType?: "TurnUdp" | "TurnTcp" | "TurnTls"
}

export function rtcConfig(iceServers: readonly IceServer[]): RtcConfig {
  const servers = iceServers.map(translate).filter((server): server is string | TurnServer => server !== null)
  return { iceServers: servers.length > 0 ? servers : ["stun:stun.cloudflare.com:3478"] }
}

function translate(server: IceServer): string | TurnServer | null {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
  const first = urls[0]
  if (!first) return null
  if (first.startsWith("stun:") || first.startsWith("turns:")) return first
  if (!first.startsWith("turn:")) return first
  const [target, query = ""] = first.slice("turn:".length).split("?")
  const [hostname, port = "3478"] = (target ?? "").split(":")
  const transport = new URLSearchParams(query).get("transport")
  return {
    hostname,
    port: Number(port),
    username: server.username,
    password: server.credential,
    relayType: transport === "tcp" ? "TurnTcp" : "TurnUdp",
  }
}

function videoSection(sdp: string): string | null {
  for (const section of sdp.split(/\r?\nm=/)) {
    const text = section.startsWith("m=") ? section : `m=${section}`
    if (!text.startsWith("m=video ")) continue
    return text
  }
  return null
}

export function videoMid(sdp: string): string {
  const section = videoSection(sdp)
  return section ? (/\r?\na=mid:(\S+)/.exec(section)?.[1] ?? "0") : "0"
}

export function videoPayloadType(sdp: string): number {
  const section = videoSection(sdp)
  const match = section ? /a=rtpmap:(\d+) H264\/90000/i.exec(section) : null
  return match ? Number(match[1]) : 102
}
