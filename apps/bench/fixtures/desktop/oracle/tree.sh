set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
xdotool windowfocus "$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")"
group=$(jq -r .group "$workdir/request.json")
item=$(jq -r .item "$workdir/request.json")
group_index=$(jq -r --arg group "$group" '.groups | map(.name) | index($group)' "$workdir/data.json")
item_index=$(jq -r --arg group "$group" --arg item "$item" '.groups[] | select(.name == $group) | .items | index($item)' "$workdir/data.json")
xdotool mousemove 48 $((40 + 32 * group_index + 16)) sleep 0.1 click 1 sleep 0.3
if [ "$group_index" -eq 0 ]; then child_row=$((1 + item_index)); else child_row=$((2 + item_index)); fi
xdotool mousemove 200 $((40 + 32 * child_row + 16)) sleep 0.1 click 1 sleep 0.2
xdotool mousemove 530 58 sleep 0.1 click 1
wait_state "$workdir/state.json" ".chosen == $(jq -n --arg v "$item" '$v')"
