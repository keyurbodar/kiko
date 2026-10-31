type Notches = (pixels: number) => number

export function notches(pixelsPerNotch: number): Notches {
  let pending = 0
  return (pixels) => {
    pending += pixels
    const whole = Math.trunc(pending / pixelsPerNotch)
    pending -= whole * pixelsPerNotch
    return whole
  }
}
