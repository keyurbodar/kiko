import { PaletteSurface } from "./surface"
import { liveSource } from "./live"

export default function Palette() {
  return <PaletteSurface source={liveSource()} />
}
