import * as Effect from "effect/Effect"
import { type Cloudflare, type CloudflareError, listScripts } from "./cloudflare"
import type { ReleaseManifest } from "./release"
import { builderBinding, builderScriptName, builderUploadBody, type UploadBinding } from "./release-plan"

export const installBuilder = (
  cf: Cloudflare,
  accountId: string,
  mainScript: string,
  release: { manifest: ReleaseManifest; files: Map<string, Uint8Array> },
): Effect.Effect<UploadBinding | null, CloudflareError> => {
  const builder = release.manifest.builder
  if (!builder) return Effect.succeed(null)
  const name = builderScriptName(mainScript)
  return listScripts(cf, accountId).pipe(
    Effect.map((scripts) =>
      builderUploadBody(builder, release.files, scripts.find((script) => script.id === name)?.migration_tag ?? null),
    ),
    Effect.flatMap((body) => cf.call(`/accounts/${accountId}/workers/scripts/${name}`, { method: "PUT", body })),
    Effect.as(builderBinding(mainScript)),
  )
}
