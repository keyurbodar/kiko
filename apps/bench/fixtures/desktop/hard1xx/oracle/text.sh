set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
text=$(jq -r .text "$workdir/request.json")
command -v setxkbmap >/dev/null 2>&1 && setxkbmap de || true
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
xdotool mousemove 200 68 sleep 0.1 click 1 sleep 0.1
xdotool type --delay 25 --clearmodifiers -- "$text"
xdotool mousemove 110 138 sleep 0.1 click 1
wait_state "$workdir/state.json" '.text != null'
