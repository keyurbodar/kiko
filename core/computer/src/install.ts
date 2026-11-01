export const COMPUTER_DAEMONS = [
  "kiko-computer-linux-x64",
  "kiko-computer-linux-arm64",
  "kiko-computer-darwin-x64",
  "kiko-computer-darwin-arm64",
  "kiko-computer-windows-x64.exe",
] as const

export const COMPUTER_APPS = [
  "kiko-macos-universal.zip",
  "kiko-windows-x64.zip",
  "kiko-linux-x64.tar.gz",
  "kiko-linux-arm64.tar.gz",
] as const

export type ComputerAsset = { name: string; sha256: string }

export const COMPUTER_SUMS_FILE = "SHA256SUMS-computer"

export const COMPUTER_REPO = "keyurbodar/kiko"

export function computerAssetBase(repo: string, version: string): string {
  return `https://github.com/${repo}/releases/download/v${version}`
}

export function computerSums(assets: readonly ComputerAsset[]): string {
  return `${assets.map((asset) => `${asset.sha256.toLowerCase()}  ${asset.name}`).join("\n")}\n`
}
