import * as Schema from "effect/Schema"
import { Hello, PROTOCOL } from "@kiko/computer/wire"
import type { Detection } from "./caps"
import { hostName, osName, VERSION } from "./platform"

export function helloPayload(detection: Detection): unknown {
  const hello: Hello = {
    t: "hello",
    protocol: PROTOCOL,
    version: VERSION,
    os: osName(),
    arch: process.arch,
    host: hostName(),
    caps: detection.caps,
    displays: detection.displays,
    ...(detection.access ? { access: detection.access } : {}),
    ...(detection.reason ? { note: detection.reason } : {}),
  }
  return Schema.encodeSync(Hello)(hello)
}
