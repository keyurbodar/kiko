set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
win=$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")
xdotool windowfocus "$win"
window_origin "$win"
plan=$(jq -r .plan "$workdir/request.json")
index=$(jq -r --arg plan "$plan" '.plans | index($plan)' "$workdir/data.json")
xdotool mousemove $((X + 160)) $((Y + 66 + 44 * index)) sleep 0.1 click 1 sleep 0.2
xdotool mousemove $((X + 110)) $((Y + 238)) sleep 0.1 click 1
wait_state "$workdir/state.json" ".plan == $(jq -n --arg v "$plan" '$v')"
