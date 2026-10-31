set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
win=$(window_named "$pid" "Bench Fixture")
xdotool windowfocus "$win"
window_origin "$win"
xdotool mousemove $((X + 110)) $((Y + 148)) sleep 0.1 click 1 sleep 0.5
xdotool windowfocus "$(window_named "$pid" "Confirm")"
xdotool sleep 0.3 key alt+d
wait_state "$workdir/state.json" '.closed == "discard"'
