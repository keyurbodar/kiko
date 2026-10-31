set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
xdotool windowfocus "$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")"
name=$(jq -r .name "$workdir/request.json")
xdotool mousemove 200 68 sleep 0.1 click 1 sleep 0.2
xdotool type --delay 20 --clearmodifiers -- "$name"
xdotool sleep 0.2 mousemove 110 148 sleep 0.1 click 1
wait_state "$workdir/state.json" ".saved == $(jq -n --arg v "$name" '$v')"
