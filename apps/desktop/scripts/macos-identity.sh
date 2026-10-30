#!/usr/bin/env bash
set -euo pipefail

dir="${1:?usage: macos-identity.sh <dir>}"
password="${KIKO_IDENTITY_PASSWORD:-$(openssl rand -hex 24)}"
mkdir -p "$dir"
chmod 700 "$dir"

if [ -f "$dir/kiko.p12" ]; then
  echo "identity already in $dir"
else
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  cat > "$work/openssl.cnf" <<'CONF'
[req]
distinguished_name = dn
x509_extensions = codesign
prompt = no

[dn]
CN = kiko

[codesign]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CONF
  openssl req -x509 -newkey rsa:3072 -sha256 -days 7300 -nodes -set_serial 1 \
    -config "$work/openssl.cnf" -extensions codesign \
    -keyout "$dir/kiko.key" -out "$dir/kiko.crt" 2>/dev/null
  openssl pkcs12 -export -inkey "$dir/kiko.key" -in "$dir/kiko.crt" \
    -name kiko -passout "pass:$password" -out "$dir/kiko.p12"
  chmod 600 "$dir/kiko.key" "$dir/kiko.crt" "$dir/kiko.p12"
  printf '%s\n' "$password" > "$dir/password"
  chmod 600 "$dir/password"
fi

hash() { if command -v shasum >/dev/null; then shasum -a 1; else sha1sum; fi; }
leaf="$(openssl x509 -in "$dir/kiko.crt" -outform der | hash | cut -d' ' -f1 | tr '[:lower:]' '[:upper:]')"
echo "certificate leaf = H\"$leaf\""
echo "designated requirement: identifier \"com.kiko.computer\" and certificate leaf = H\"$leaf\""
