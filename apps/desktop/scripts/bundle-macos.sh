#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
desktop="$(cd "$here/.." && pwd)"
root="$(cd "$desktop/../.." && pwd)"
crate="$desktop/crates/kiko-app"

arch="${1:-arm64}"
out="${2:-$desktop/dist}"
identity="${3:-kiko}"
target="${CARGO_TARGET_DIR:-$desktop/target}"
triple="$([ "$arch" = "arm64" ] && echo aarch64-apple-darwin || echo x86_64-apple-darwin)"
binary="${KIKO_BIN:-$target/$triple/release/kiko}"
core="${KIKO_CORE_BIN:-$root/apps/computer/dist/kiko-computer-darwin-$arch}"
version="${KIKO_VERSION:-$(grep -m1 '"version"' "$root/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')}"

[ -f "$binary" ] || { echo "missing $binary"; exit 1; }
[ -f "$core" ] || { echo "missing $core"; exit 1; }

app="$out/kiko.app"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.kiko.computer</string>
  <key>CFBundleName</key><string>kiko</string>
  <key>CFBundleDisplayName</key><string>kiko</string>
  <key>CFBundleExecutable</key><string>kiko</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAccessibilityUsageDescription</key><string>kiko reads the screen and drives apps so your agent can work on this computer without taking it over.</string>
  <key>NSAppleEventsUsageDescription</key><string>kiko controls the browsers and apps you approve so your agent can work in them.</string>
  <key>NSScreenCaptureUsageDescription</key><string>kiko looks at the windows of the apps your agent is working in.</string>
  <key>NSHumanReadableCopyright</key><string>kiko</string>
</dict>
</plist>
PLIST

install -m 755 "$binary" "$app/Contents/MacOS/kiko"
install -m 755 "$core" "$app/Contents/MacOS/kiko-core"

iconset="$work/icon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$crate/resources/icon-1024.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$crate/resources/icon-1024.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/icon.icns"

entitlements="$crate/resources/kiko.entitlements"
codesign --force --options runtime --timestamp=none --entitlements "$entitlements" --sign "$identity" "$app/Contents/MacOS/kiko-core"
codesign --force --options runtime --timestamp=none --entitlements "$entitlements" --sign "$identity" "$app/Contents/MacOS/kiko"
codesign --force --options runtime --timestamp=none --entitlements "$entitlements" --identifier com.kiko.computer --sign "$identity" "$app"

echo "built $app"
codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p'
