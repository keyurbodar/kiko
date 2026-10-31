import type { Contender } from "../types"
import { AgentBrowserContender } from "./agent-browser"
import { AgentDesktopContender } from "./agent-desktop"
import { baselineShell } from "./baseline-shell"
import { CuaDriverContender } from "./cua-driver"
import { kikoContender } from "./kiko"

export const CONTENDERS: Readonly<Record<string, () => Contender>> = {
  kiko: () => kikoContender(),
  "baseline-shell": () => baselineShell(),
  "cua-driver": () => new CuaDriverContender(),
  "agent-desktop": () => new AgentDesktopContender(),
  "agent-browser": () => new AgentBrowserContender(),
}
