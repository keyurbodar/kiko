import * as Schema from "effect/Schema"
import { Hello, PROTOCOL } from "@kiko/computer/wire"
import type { Detection } from "./caps"
import type { Driver } from "./driver"
import { hostName, osName, VERSION } from "./platform"

export function helloPayload(detection: Detection, driver: Driver | null): unknown {
  const state = driver?.state() ?? null
  const hello: Hello = {
    t: "hello",
    protocol: PROTOCOL,
    version: VERSION,
    os: osName(),
    arch: process.arch,
    host: hostName(),
    caps: {
      ...detection.caps,
      background: driver?.background() ?? false,
      browser: driver?.browser() ?? false,
    },
    displays: detection.displays,
    ...(detection.access ? { access: detection.access } : {}),
    ...(state ? { driver: state } : {}),
    ...(detection.reason ? { note: detection.reason } : {}),
  }
  return Schema.encodeSync(Hello)(hello)
}
