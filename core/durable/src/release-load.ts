// Fetches a release and refuses it unless the signature and every module hash match. Both the installer
// and the in-place update call this, so nothing unsigned reaches an upload.

import { type ReleaseManifest, parseManifest, verifyModuleHash, verifyRelease } from "./release"

type ReleaseFetch = (url: string) => Promise<Response>

export class ReleaseRefused extends Error {
  constructor(
    readonly code: "release_unavailable" | "release_untrusted",
    message: string,
  ) {
    super(message)
  }
}

async function fetchBytes(f: ReleaseFetch, url: string): Promise<Uint8Array> {
  let res: Response
  try {
    res = await f(url)
  } catch {
    throw new ReleaseRefused("release_unavailable", `The release file ${url.split("/").pop()} could not be fetched.`)
  }
  if (!res.ok) throw new ReleaseRefused("release_unavailable", `The release file ${url.split("/").pop()} could not be fetched.`)
  return new Uint8Array(await res.arrayBuffer())
}

type LoadedRelease = { manifest: ReleaseManifest; files: Map<string, Uint8Array> }

/** `version` names an exact release. Without it the release the base calls `latest`. */
export async function loadVerifiedRelease(
  input: { baseUrl: string; publicKey: string; version?: string; index?: "latest.json" | "latest-owner.json" },
  f: ReleaseFetch,
): Promise<LoadedRelease> {
  const base = input.baseUrl.replace(/\/$/, "")
  const version =
    input.version ?? (JSON.parse(new TextDecoder().decode(await fetchBytes(f, `${base}/${input.index ?? "latest.json"}`))) as { version: string }).version
  if (!/^[A-Za-z0-9._-]+$/.test(version)) throw new ReleaseRefused("release_untrusted", "The release version is not valid. Nothing was uploaded.")
  const dir = `${base}/${version}`
  const manifestBytes = await fetchBytes(f, `${dir}/manifest.json`)
  const signature = new TextDecoder().decode(await fetchBytes(f, `${dir}/manifest.sig`))
  if (!(await verifyRelease(manifestBytes, signature, input.publicKey))) {
    throw new ReleaseRefused("release_untrusted", "The release signature is not valid. Nothing was uploaded.")
  }
  const manifest = parseManifest(manifestBytes)
  if (!manifest) throw new ReleaseRefused("release_untrusted", "The release manifest is malformed. Nothing was uploaded.")
  if (input.version && manifest.version !== input.version) {
    throw new ReleaseRefused("release_untrusted", "The release is not the version that was asked for. Nothing was uploaded.")
  }
  const files = new Map<string, Uint8Array>()
  for (const module of manifest.modules) {
    const bytes = await fetchBytes(f, `${dir}/${module.name}`)
    if (!(await verifyModuleHash(module, bytes))) {
      throw new ReleaseRefused("release_untrusted", `Module ${module.name} does not match the signed manifest. Nothing was uploaded.`)
    }
    files.set(module.name, bytes)
  }
  return { manifest, files }
}
