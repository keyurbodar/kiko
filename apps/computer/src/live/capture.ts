export type Platform = "macos" | "linux" | "windows"

export function platform(): Platform {
  if (process.platform === "darwin") return "macos"
  if (process.platform === "win32") return "windows"
  return "linux"
}

const MAX_LONG_EDGE = 2560
const KEYFRAME_SECONDS = 1
const VAAPI_DEVICE = "/dev/dri/renderD128"

export type Screen = { width: number; height: number; scale?: number; originX?: number; originY?: number }

export type CaptureOptions = {
  ffmpeg: string
  screen: Screen
  format: "h264" | "mjpeg"
  fps: number
  maxWidth: number
  quality: number
  encoders: readonly string[]
  screenIndex?: number
}

type Encoder = { name: string; args: readonly string[] }

const HARDWARE: readonly Encoder[] = [
  { name: "h264_videotoolbox", args: ["-realtime", "true", "-allow_sw", "1"] },
  { name: "h264_nvenc", args: ["-preset", "p1", "-tune", "ull", "-zerolatency", "1"] },
  { name: "h264_qsv", args: ["-preset", "veryfast", "-low_power", "1"] },
  { name: "h264_mf", args: ["-scenario", "display_remoting"] },
  { name: "h264_vaapi", args: [] },
]

const SOFTWARE: readonly string[] = ["libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-bf", "0"]

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function physical(screen: Screen): { width: number; height: number } {
  const scale = screen.scale && screen.scale > 0 ? screen.scale : 1
  return { width: screen.width * scale, height: screen.height * scale }
}

export function captureSize(screen: Screen, maxWidth: number): { width: number; height: number } {
  const source = physical(screen)
  const width = maxWidth > 0 ? Math.min(MAX_LONG_EDGE, maxWidth) : MAX_LONG_EDGE
  const ratio = Math.min(
    1,
    width / Math.max(1, source.width),
    MAX_LONG_EDGE / Math.max(1, Math.max(source.width, source.height)),
  )
  return { width: even(source.width * ratio), height: even(source.height * ratio) }
}

function quality(level: number): string {
  return String(Math.round(31 - (Math.min(100, Math.max(1, level)) / 100) * 19))
}

function linuxSources(screen: Screen, fps: number): string[][] {
  const origin = `${screen.originX ?? 0},${screen.originY ?? 0}`
  const size = physical(screen)
  return [
    [
      "-f",
      "x11grab",
      "-draw_mouse",
      "1",
      "-framerate",
      String(fps),
      "-video_size",
      `${Math.round(size.width) || 1}x${Math.round(size.height) || 1}`,
      "-i",
      `${process.env.DISPLAY ?? ":0"}+${origin}`,
    ],
  ]
}

function macSources(fps: number, index: number): string[][] {
  return [
    ["-f", "avfoundation", "-capture_cursor", "1", "-framerate", String(fps), "-i", `Capture screen ${index}:none`],
  ]
}

function windowsSources(screen: Screen, fps: number): string[][] {
  const offset = `:offset_x=${screen.originX ?? 0}:offset_y=${screen.originY ?? 0}`
  const size = physical(screen)
  return [
    ["-f", "lavfi", "-i", `ddagrab=output_idx=0:framerate=${fps}:draw_mouse=1`],
    ["-f", "lavfi", "-i", `ddagrab=output_idx=0:framerate=${fps}:draw_mouse=1${offset}`],
    [
      "-f",
      "gdigrab",
      "-draw_mouse",
      "1",
      "-framerate",
      String(fps),
      "-offset_x",
      String(screen.originX ?? 0),
      "-offset_y",
      String(screen.originY ?? 0),
      "-video_size",
      `${Math.round(size.width)}x${Math.round(size.height)}`,
      "-i",
      "desktop",
    ],
  ]
}

function sources(options: CaptureOptions): string[][] {
  const name = platform()
  if (name === "macos") return macSources(options.fps, options.screenIndex ?? 0)
  if (name === "windows") return windowsSources(options.screen, options.fps)
  return linuxSources(options.screen, options.fps)
}

function videoEncoders(options: CaptureOptions): Encoder[] {
  if (options.format === "mjpeg") return [{ name: "mjpeg", args: ["-c:v", "mjpeg", "-q:v", quality(options.quality)] }]
  const gop = ["-g", String(Math.max(2, Math.round(options.fps * KEYFRAME_SECONDS)))]
  const force = ["-force_key_frames", `expr:gte(t,n_forced*${KEYFRAME_SECONDS})`]
  const hardware = HARDWARE.filter(({ name }) => options.encoders.includes(name)).map(({ name, args }) => ({
    name,
    args: ["-c:v", name, ...args, ...gop, ...force],
  }))
  return [...hardware, { name: "libx264", args: ["-c:v", ...SOFTWARE, ...gop, ...force] }]
}

function inputFilter(options: CaptureOptions, encoder: string, source: readonly string[]): string[] {
  const size = captureSize(options.screen, options.maxWidth)
  const gpuFrames = source.some((part) => part.startsWith("ddagrab"))
  const scale = `${gpuFrames ? "hwdownload,format=bgra," : ""}scale=${size.width}:${size.height}:flags=fast_bilinear`
  return ["-vf", encoder === "h264_vaapi" ? `${scale},format=nv12,hwupload` : scale]
}

export function capturePlans(options: CaptureOptions): string[][] {
  const output = ["-f", options.format === "h264" ? "h264" : "mjpeg", "pipe:1"]
  const head = [options.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin"]
  const fixed = ["-r", String(options.fps), "-an"]
  return sources(options).flatMap((source) =>
    videoEncoders(options).map((encoder) => [
      ...head,
      ...(encoder.name === "h264_vaapi" ? ["-vaapi_device", VAAPI_DEVICE] : []),
      ...source,
      ...fixed,
      ...inputFilter(options, encoder.name, source),
      ...encoder.args,
      ...output,
    ]),
  )
}

async function encodes(ffmpeg: string, encoder: Encoder): Promise<boolean> {
  const vaapi = encoder.name === "h264_vaapi"
  const probe = Bun.spawn(
    [
      ffmpeg,
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      ...(vaapi ? ["-vaapi_device", VAAPI_DEVICE] : []),
      "-f",
      "lavfi",
      "-i",
      "color=s=256x256:d=0.1",
      ...(vaapi ? ["-vf", "format=nv12,hwupload"] : []),
      "-frames:v",
      "1",
      "-c:v",
      encoder.name,
      ...encoder.args,
      "-f",
      "null",
      "-",
    ],
    { stdout: "ignore", stderr: "ignore", timeout: 5_000 },
  )
  return (await probe.exited) === 0
}

export async function workingEncoders(ffmpeg: string, available: readonly string[]): Promise<string[]> {
  const candidates = HARDWARE.filter(({ name }) => available.includes(name))
  const results = await Promise.all(candidates.map((encoder) => encodes(ffmpeg, encoder)))
  return candidates.filter((_, index) => results[index]).map(({ name }) => name)
}
