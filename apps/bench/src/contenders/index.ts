import type { Contender } from "../types"
import { AgentBrowserContender } from "./agent-browser"
import { AgentDesktopContender } from "./agent-desktop"
import { baselineShell } from "./baseline-shell"
import { CuaDriverContender } from "./cua-driver"
import { kikoContender } from "./kiko"
import { kikoRemote } from "./kiko-remote"

export const CONTENDERS: Readonly<Record<string, () => Contender>> = {
  kiko: () => kikoContender(),
  "baseline-shell": () => baselineShell(),
  "kiko-remote": () => kikoRemote(),
  "cua-driver": () => new CuaDriverContender(),
  "agent-desktop": () => new AgentDesktopContender(),
  "agent-browser": () => new AgentBrowserContender(),
}
