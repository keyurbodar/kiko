export const T3_VERSION = "0.1.6"
export const T3_SOURCE_SHA = "79f1fadfc6020b820d541ca4691d2feebb15dd1b"
export const T3_RELEASE_BASE = `https://github.com/pingdotgg/t3code/releases/download/v${T3_VERSION}`

export interface T3Release {
  readonly asset: string
  readonly sha256: string
}

const RELEASES: Readonly<Record<string, T3Release>> = {
  "linux-x64": {
    asset: `t3-${T3_VERSION}-linux-x64.tar.gz`,
    sha256: "7cf31da90dee41f524dd5b679ebb6d404637ca5d9dc6fd8bc019511d57bb77e6",
  },
  "linux-arm64": {
    asset: `t3-${T3_VERSION}-linux-arm64.tar.gz`,
    sha256: "b708f059200776f50623a766854841e40eda0bb67614211cf8b6909295ce20da",
  },
  "darwin-arm64": {
    asset: `t3-${T3_VERSION}-darwin-arm64.tar.gz`,
    sha256: "50c5dfd3e83787c182299a37db3553968346904e7dc7936b2a01061dbfcf90eb",
  },
  "win32-x64": {
    asset: `t3-${T3_VERSION}-win32-x64.zip`,
    sha256: "486604df780a72273fac94506e21edda6cab762cd4417393007c2953a44e609f",
  },
  "win32-arm64": {
    asset: `t3-${T3_VERSION}-win32-arm64.zip`,
    sha256: "6852c0ec6a7fdb11306dcca071c13bf3c4116dc7f75627d5cea6727704b9dfc6",
  },
}

export const releaseFor = (platform: string, arch: string): T3Release | undefined => {
  const release = RELEASES[`${platform}-${arch}`]
  return release === undefined || release.sha256 === "" ? undefined : release
}

export const AGENT_TOOL_NAMES: readonly string[] = [
  "preview_status",
  "preview_open",
  "preview_dialog",
  "preview_navigate",
  "preview_resize",
  "preview_set_appearance",
  "preview_snapshot",
  "preview_act",
  "preview_evaluate",
  "preview_wait_for",
  "preview_recording_start",
  "preview_recording_stop",
  "html_preview",
  "html_render",
  "t3_worktree_list",
  "t3_worktree_status",
  "t3_worktree_handoff",
]

export const PROVIDER_INSTANCE_ID = "bench-t3code"
export const PROVIDER_MODEL = "default"
