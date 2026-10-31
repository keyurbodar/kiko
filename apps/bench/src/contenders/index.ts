import type { Contender } from "../types"
import { baselineShell } from "./baseline-shell"
import { kikoContender } from "./kiko"

export const CONTENDERS: Readonly<Record<string, () => Contender>> = {
  kiko: () => kikoContender(),
  "baseline-shell": () => baselineShell(),
}
