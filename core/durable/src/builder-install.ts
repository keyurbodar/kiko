import * as Effect from "effect/Effect"
import { type Cloudflare, listScripts } from "./cloudflare"
import type { ReleaseManifest } from "./release"
import { builderBinding, builderScriptName, builderUploadBody, type UploadBinding } from "./release-plan"

export const installBuilder = (
  cf: Cloudflare,
  accountId: string,
  mainScript: string,
  release: { manifest: ReleaseManifest; files: Map<string, Uint8Array> },
): Effect.Effect<UploadBinding | null> => {
  const builder = release.manifest.builder
  if (!builder) return Effect.succeed(null)
  const name = builderScriptName(mainScript)
  return listScripts(cf, accountId).pipe(
    Effect.flatMap((scripts) =>
      Effect.try(() => builderUploadBody(builder, release.files, scripts.find((script) => script.id === name) ?? null)),
    ),
    Effect.flatMap((body) => cf.call(`/accounts/${accountId}/workers/scripts/${name}`, { method: "PUT", body })),
    Effect.as(builderBinding(mainScript)),
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(`app builder install failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }),
    ),
  )
}
