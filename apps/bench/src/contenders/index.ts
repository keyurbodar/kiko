import type { Contender } from "../types"
import { AgentBrowserContender } from "./agent-browser"
import { AgentDesktopContender } from "./agent-desktop"
import { baselineShell } from "./baseline-shell"
import { CuaDriverContender } from "./cua-driver"
import { withHarness } from "./harness"
import { kikoContender } from "./kiko"
import { kikoRemote } from "./kiko-remote"

export const CONTENDERS: Readonly<Record<string, () => Contender>> = {
  kiko: () => kikoContender(),
  "kiko-remote": () => kikoRemote(),
  "baseline-shell": () => baselineShell(),
  "cua-driver": () => withHarness(new CuaDriverContender()),
  "agent-desktop": () => withHarness(new AgentDesktopContender()),
  "agent-browser": () => withHarness(new AgentBrowserContender()),
}
