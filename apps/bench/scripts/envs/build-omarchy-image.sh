#!/usr/bin/env bash
set -euo pipefail

out="${1:?usage: build-omarchy-image.sh <out.qcow2>}"
here="$(cd "$(dirname "$0")/../../envs/omarchy-v3.8.4" && pwd)"
# shellcheck disable=SC1091
source "$here/image.env"

work="$(mktemp -d)"
base="$work/arch.qcow2"
seed="$work/seed"
overlay="$work/omarchy.qcow2"
log="$work/qemu.log"
boot_pid=""

cleanup() {
  if [ -n "$boot_pid" ]; then kill "$boot_pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

curl --fail --location --silent --show-error --output "$base" "$ARCH_BASE_URL/$ARCH_IMAGE"
actual="$(sha256sum "$base" | awk '{print $1}')"
if [ "$actual" != "$ARCH_SHA256" ]; then
  echo "build-omarchy-image: sha256 mismatch for $ARCH_IMAGE: expected $ARCH_SHA256, got $actual" >&2
  exit 1
fi

mkdir -p "$seed"
hash="$(openssl passwd -6 bench)"
cat >"$seed/user-data" <<EOF
#cloud-config
growpart:
  mode: auto
  devices: ["/"]
resize_rootfs: true
users:
  - name: bench
    groups: wheel, input, video, render
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    passwd: $hash
ssh_pwauth: true
chpasswd:
  expire: false
EOF
cat >"$seed/meta-data" <<EOF
instance-id: kiko-bench-omarchy
local-hostname: bench
EOF
genisoimage -output "$work/seed.iso" -volid cidata -joliet -rock "$seed" >/dev/null 2>&1

qemu-img create -f qcow2 -F qcow2 -b "$base" "$overlay" >/dev/null
qemu-img resize "$overlay" 20G >/dev/null
qemu-system-x86_64 \
  -machine q35,accel=kvm -cpu host -smp 4 -m 8192 \
  -drive "file=$overlay,if=virtio,format=qcow2" \
  -drive "file=$work/seed.iso,media=cdrom,readonly=on" \
  -vga std \
  -netdev "user,id=net0,hostfwd=tcp::2222-:22" -device virtio-net-pci,netdev=net0 \
  -nographic >"$log" 2>&1 &
boot_pid=$!

ssh_opts=(-p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o ServerAliveInterval=30)
export SSHPASS=bench

ready=0
for _ in $(seq 1 180); do
  if sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 true >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$boot_pid" 2>/dev/null; then
    echo "build-omarchy-image: the cloud image exited before ssh came up" >&2
    tail -n 200 "$log" >&2 || true
    exit 1
  fi
  sleep 5
done
if [ "$ready" != "1" ]; then
  echo "build-omarchy-image: ssh did not come up within 15 minutes" >&2
  tail -n 200 "$log" >&2 || true
  exit 1
fi

sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 \
  'sudo growpart /dev/vda 1 >/dev/null 2>&1 || true; sudo resize2fs /dev/vda1 >/dev/null 2>&1 || true; df -h /'

sshpass -e scp -P 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "$here/install.sh" bench@127.0.0.1:/tmp/omarchy-install.sh
sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 'bash /tmp/omarchy-install.sh'

sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 'sudo poweroff' || true
for _ in $(seq 1 60); do
  if ! kill -0 "$boot_pid" 2>/dev/null; then break; fi
  sleep 2
done
kill "$boot_pid" 2>/dev/null || true
wait "$boot_pid" 2>/dev/null || true
boot_pid=""

mkdir -p "$(dirname "$out")"
qemu-img convert -O qcow2 -c "$overlay" "$out"
echo "$out"
