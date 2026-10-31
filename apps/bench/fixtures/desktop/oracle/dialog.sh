set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
xdotool mousemove 110 148 sleep 0.1 click 1 sleep 0.5
xdotool windowfocus "$(window_named "$pid" "Confirm")"
xdotool sleep 0.3 key alt+d
wait_state "$workdir/state.json" '.closed == "discard"'
