set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
win=$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")
xdotool windowfocus "$win"
window_origin "$win"
name=$(jq -r .name "$workdir/request.json")
xdotool mousemove $((X + 200)) $((Y + 68)) sleep 0.1 click 1 sleep 0.2
xdotool type --delay 20 --clearmodifiers -- "$name"
xdotool sleep 0.2 mousemove $((X + 110)) $((Y + 148)) sleep 0.1 click 1
wait_state "$workdir/state.json" ".saved == $(jq -n --arg v "$name" '$v')"
