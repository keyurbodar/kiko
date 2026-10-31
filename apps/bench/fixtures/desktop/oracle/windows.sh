set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
note=$(jq -r .note "$workdir/request.json")
xdotool mousemove 130 68 sleep 0.1 click 1 sleep 0.8
notes=$(window_named "$pid" "Notes")
eval "$(xdotool getwindowgeometry --shell "$notes")"
xdotool windowfocus "$notes"
xdotool mousemove $((X + 180)) $((Y + 68)) sleep 0.2 click 1 sleep 0.2
xdotool type --delay 20 --clearmodifiers -- "$note"
xdotool sleep 0.2 mousemove $((X + 100)) $((Y + 128)) sleep 0.1 click 1
wait_state "$workdir/state.json" ".note == $(jq -n --arg v "$note" '$v')"
