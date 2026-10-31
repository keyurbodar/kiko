import type { Contender } from "../types"
import { baselineShell } from "./baseline-shell"
import { kikoContender } from "./kiko"
import { kikoRemote } from "./kiko-remote"

export const CONTENDERS: Readonly<Record<string, () => Contender>> = {
  kiko: () => kikoContender(),
  "baseline-shell": () => baselineShell(),
  "kiko-remote": () => kikoRemote(),
}
