import { cssFontFamilies } from "@kiko/theme/display"

const PROBE_TEXT = "mmmmmmmmMMWli1O0@# fjord"
let probe: CanvasRenderingContext2D | null | undefined

function probeWidth(fontList: string): number | null {
  if (probe === undefined) probe = document.createElement("canvas").getContext("2d")
  if (probe === null) return null
  probe.font = `16px ${fontList}`
  return probe.measureText(PROBE_TEXT).width
}

export function isFontFamilyAvailable(family: string): boolean {
  const families = cssFontFamilies(family)
  if (families === null) return false
  if (/^(system-ui|sans-serif|serif|monospace|ui-monospace)$/i.test(families)) return true
  try {
    for (const generic of ["monospace", "serif", "sans-serif"]) {
      const baseline = probeWidth(generic)
      const candidate = probeWidth(`${families}, ${generic}`)
      if (baseline === null || candidate === null) return false
      if (candidate !== baseline) return true
    }
    return false
  } catch {
    return false
  }
}
