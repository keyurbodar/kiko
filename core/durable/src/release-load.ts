import * as Schema from "effect/Schema"
import { BUILDER_DIR, type ReleaseManifest, parseManifest, verifyModuleHash, verifyRelease } from "./release"

type ReleaseFetch = (url: string) => Promise<Response>

export class ReleaseRefused extends Schema.TaggedError<ReleaseRefused>()("ReleaseRefused", {
  code: Schema.Literals(["release_unavailable", "release_untrusted"]),
  message: Schema.String,
}) {}

async function fetchBytes(f: ReleaseFetch, url: string): Promise<Uint8Array> {
  let res: Response
  try {
    res = await f(url)
  } catch {
    throw new ReleaseRefused({
      code: "release_unavailable",
      message: `The release file ${url.split("/").pop()} could not be fetched.`,
    })
  }
  if (!res.ok)
    throw new ReleaseRefused({
      code: "release_unavailable",
      message: `The release file ${url.split("/").pop()} could not be fetched.`,
    })
  return new Uint8Array(await res.arrayBuffer())
}

type LoadedRelease = { manifest: ReleaseManifest; files: Map<string, Uint8Array> }

export async function loadVerifiedRelease(
  input: { baseUrl: string; publicKey: string; version?: string },
  f: ReleaseFetch,
): Promise<LoadedRelease> {
  const base = input.baseUrl.replace(/\/$/, "")
  const version =
    input.version ??
    (JSON.parse(new TextDecoder().decode(await fetchBytes(f, `${base}/latest-owner.json`))) as { version: string })
      .version
  if (!/^[A-Za-z0-9._-]+$/.test(version))
    throw new ReleaseRefused({
      code: "release_untrusted",
      message: "The release version is not valid. Nothing was uploaded.",
    })
  const dir = `${base}/${version}`
  const manifestBytes = await fetchBytes(f, `${dir}/manifest.json`)
  const signature = new TextDecoder().decode(await fetchBytes(f, `${dir}/manifest.sig`))
  if (!(await verifyRelease(manifestBytes, signature, input.publicKey))) {
    throw new ReleaseRefused({
      code: "release_untrusted",
      message: "The release signature is not valid. Nothing was uploaded.",
    })
  }
  const manifest = parseManifest(manifestBytes)
  if (!manifest)
    throw new ReleaseRefused({
      code: "release_untrusted",
      message: "The release manifest is malformed or deletes stored data. Nothing was uploaded.",
    })
  if (input.version && manifest.version !== input.version) {
    throw new ReleaseRefused({
      code: "release_untrusted",
      message: "The release is not the version that was asked for. Nothing was uploaded.",
    })
  }
  const files = new Map<string, Uint8Array>()
  for (const module of manifest.modules) {
    const bytes = await fetchBytes(f, `${dir}/${module.name}`)
    if (!(await verifyModuleHash(module, bytes))) {
      throw new ReleaseRefused({
        code: "release_untrusted",
        message: `Module ${module.name} does not match the signed manifest. Nothing was uploaded.`,
      })
    }
    files.set(module.name, bytes)
  }
  for (const module of manifest.builder?.modules ?? []) {
    const name = `${BUILDER_DIR}/${module.name}`
    const bytes = await fetchBytes(f, `${dir}/${name}`)
    if (!(await verifyModuleHash(module, bytes))) {
      throw new ReleaseRefused({
        code: "release_untrusted",
        message: `Module ${name} does not match the signed manifest. Nothing was uploaded.`,
      })
    }
    files.set(name, bytes)
  }
  return { manifest, files }
}
