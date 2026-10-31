import { linuxDesk } from "../src/desk/linux"
import { Fail } from "../src/log"

const SIGNAL = new AbortController().signal

function size(bytes: Uint8Array<ArrayBuffer>): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getInt32(18, true), height: -view.getInt32(22, true) }
}

const desk = linuxDesk()
if (!desk) throw new Error("no X display; run this under xvfb-run")

try {
  const area = desk.area()
  if (!area) throw new Error("the X display has no size")

  const oversized = size(
    (await desk.shoot({ originX: 0, originY: 0, width: area.width + 500, height: area.height + 500 }, SIGNAL)).bytes,
  )
  if (oversized.width !== area.width || oversized.height !== area.height)
    throw new Error(
      `an oversized capture came back ${oversized.width}x${oversized.height}, not ${area.width}x${area.height}`,
    )
  console.log(`oversized capture clamped to ${oversized.width}x${oversized.height}`)

  let refused = false
  try {
    await desk.shoot({ originX: area.width + 10, originY: 0, width: 32, height: 32 }, SIGNAL)
  } catch (error) {
    if (!(error instanceof Fail)) throw error
    refused = true
    console.log(`off-screen capture refused: ${error.message}`)
  }
  if (!refused) throw new Error("an off-screen capture should have been refused")

  const after = size((await desk.shoot({ originX: 0, originY: 0, width: 16, height: 16 }, SIGNAL)).bytes)
  if (after.width !== 16 || after.height !== 16) throw new Error(`the display stopped working after a refused capture`)
  console.log("the daemon still captures after a refused request")
} finally {
  desk.close()
}
