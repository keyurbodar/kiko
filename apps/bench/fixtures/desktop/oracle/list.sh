set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
xdotool windowfocus "$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")"
name=$(jq -r .move "$workdir/request.json")
index=$(jq -r --arg name "$name" '.items | index($name)' "$workdir/data.json")
source_y=$((50 + 32 * index + 16))
xdotool mousemove 200 "$source_y" sleep 0.2 mousedown 1 sleep 0.2
xdotool mousemove 200 $((source_y - 4)) sleep 0.15 mousemove 200 $((source_y - 16)) sleep 0.15
xdotool mousemove 200 $((source_y - 40)) sleep 0.15 mousemove 200 100 sleep 0.2 mousemove 200 66 sleep 0.5
xdotool mouseup 1
wait_state "$workdir/state.json" ".order[0] == $(jq -n --arg v "$name" '$v')"
