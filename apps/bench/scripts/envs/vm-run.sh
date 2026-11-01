#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: vm-run.sh <env> <image> <results> <port> <track> <contender> -- <bench args...>" >&2
  exit 2
}

[ "$#" -ge 7 ] || usage
env_id="$1"
image="$2"
results="$3"
port="$4"
track="$5"
contender="$6"
shift 6
[ "$1" = "--" ] && shift

share=/tmp/kiko-bench-repo
overlay=""
boot_pid=""

cleanup() {
  if [ -n "$boot_pid" ]; then kill "$boot_pid" 2>/dev/null || true; fi
  if [ -n "$overlay" ]; then rm -f "$overlay"; fi
}
trap cleanup EXIT

rm -rf "$share"
mkdir -p "$share"
rsync -a --exclude .git --exclude node_modules --exclude results --exclude .nix-vm --exclude .omarchy-image ./ "$share"/

{
  printf '#!/usr/bin/env bash\nset -euo pipefail\n'
  printf 'export BENCH_ENV_ID=%q\n' "$env_id"
  printf 'cd "$HOME/repo"\n'
  if [ "$track" = "desktop" ] || [ "${BENCH_SESSION:-}" = "true" ]; then
    printf 'exec bash apps/bench/envs/%q/session.sh bash apps/bench/scripts/envs/run-bench.sh %q' "$env_id" "$contender"
  else
    printf 'exec bash apps/bench/scripts/envs/run-bench.sh %q' "$contender"
  fi
  printf ' %q' "$@"
  printf '\n'
} >"$share/.bench-command.sh"
chmod +x "$share/.bench-command.sh"

boot_log="$(mktemp)"
case "$env_id" in
  nixos-*)
    "$image" >"$boot_log" 2>&1 &
    boot_pid=$!
    ;;
  omarchy-*)
    overlay="$(mktemp --suffix=.qcow2)"
    qemu-img create -f qcow2 -F qcow2 -b "$(realpath "$image")" "$overlay" >/dev/null
    qemu-system-x86_64 \
      -machine q35,accel=kvm -cpu host -smp 2 -m 4096 \
      -drive "file=$overlay,if=virtio,format=qcow2" \
      -vga std \
      -netdev "user,id=net0,hostfwd=tcp::$port-:22" -device virtio-net-pci,netdev=net0 \
      -virtfs "local,path=$share,mount_tag=repo,security_model=none" \
      -nographic >"$boot_log" 2>&1 &
    boot_pid=$!
    ;;
  *)
    echo "vm-run: $env_id is not a virtual machine" >&2
    exit 2
    ;;
esac

ssh_opts=(-p "$port" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o ServerAliveInterval=30)
export SSHPASS=bench

ready=0
for _ in $(seq 1 180); do
  if sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 true >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$boot_pid" 2>/dev/null; then
    echo "vm-run: the virtual machine exited before ssh came up" >&2
    tail -n 200 "$boot_log" >&2 || true
    exit 1
  fi
  sleep 5
done
if [ "$ready" != "1" ]; then
  echo "vm-run: ssh did not come up within 15 minutes" >&2
  tail -n 200 "$boot_log" >&2 || true
  exit 1
fi

if [ "$env_id" = "omarchy-v3.8.4" ]; then
  sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 \
    'sudo modprobe 9p 9pnet_virtio 2>/dev/null || true; sudo mkdir -p /mnt/repo; sudo mount -t 9p -o trans=virtio,version=9p2000.L,msize=104857600 repo /mnt/repo'
fi

sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 \
  'export PATH=/run/current-system/sw/bin:$PATH; rm -rf "$HOME/repo" && mkdir -p "$HOME/repo" && cp -a /mnt/repo/. "$HOME/repo/"'

printf '%s' "${OPENCODE_GO_KEY:?OPENCODE_GO_KEY is not set}" |
  sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 \
    'export PATH=/run/current-system/sw/bin:$PATH; umask 077; mkdir -p "$HOME/.config/kiko-bench"; cat > "$HOME/.config/kiko-bench/opencode.key"'

set +e
sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 \
  'if [ -x /run/current-system/sw/bin/bash ]; then exec /run/current-system/sw/bin/bash "$HOME/repo/.bench-command.sh"; fi; exec bash "$HOME/repo/.bench-command.sh"'
run_status=$?
set -e

mkdir -p "$results"
sshpass -e ssh "${ssh_opts[@]}" bench@127.0.0.1 'export PATH=/run/current-system/sw/bin:$PATH; cd "$HOME/repo" && tar -cf - results 2>/dev/null' |
  tar -xf - -C "$results" 2>/dev/null || true

exit "$run_status"
