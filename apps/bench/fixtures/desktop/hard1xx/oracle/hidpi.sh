set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
code=$(jq -r .code "$workdir/request.json")
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
xdotool mousemove 380 136 sleep 0.1 click 1 sleep 0.1
xdotool type --delay 15 --clearmodifiers -- "$code"
xdotool mousemove 220 276 sleep 0.1 click 1
wait_state "$workdir/state.json" '.code != null'
