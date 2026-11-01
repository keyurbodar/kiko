set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
win=$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")
xdotool windowfocus "$win"
window_origin "$win"
value=$(jq -r .value "$workdir/request.json")
xdotool mousemove $((X + 200)) $((Y + 70)) sleep 0.1 click 1 sleep 0.2
xdotool key Home sleep 0.2
xdotool key --repeat "$value" Right sleep 0.2
xdotool mousemove $((X + 110)) $((Y + 148)) sleep 0.1 click 1
wait_state "$workdir/state.json" ".value == $value"
