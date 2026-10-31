set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
win=$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")
xdotool windowfocus "$win"
window_origin "$win"
code=$(jq -r .code "$workdir/data.json")
xdotool mousemove $((X + 160)) $((Y + 158)) sleep 0.1 click 1 sleep 0.2
xdotool type --delay 20 --clearmodifiers -- "$code"
xdotool sleep 0.2 mousemove $((X + 110)) $((Y + 218)) sleep 0.1 click 1
wait_state "$workdir/state.json" ".code == $(jq -n --arg v "$code" '$v')"
