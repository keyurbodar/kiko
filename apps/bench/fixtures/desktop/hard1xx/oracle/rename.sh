set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
prefix=$(jq -r .prefix "$workdir/request.json")
start=$(jq -r .start "$workdir/request.json")
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
xdotool mousemove 500 88 sleep 0.1 click 1 sleep 0.1
xdotool type --delay 20 --clearmodifiers -- "$prefix"
xdotool mousemove 460 168 sleep 0.1 click 1 sleep 0.1
xdotool key --clearmodifiers ctrl+a
xdotool type --delay 20 --clearmodifiers -- "$start"
xdotool mousemove 500 238 sleep 0.1 click 1
wait_state "$workdir/state.json" '.renamed != null'
