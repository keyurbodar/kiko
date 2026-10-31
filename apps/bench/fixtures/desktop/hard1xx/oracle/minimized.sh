set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
code=$(jq -r .code "$workdir/request.json")
sleep 1.5
target=$(window_named_any "$pid" "Bench Fixture")
xdotool windowmap "$target" || true
xdotool windowactivate "$target" || true
sleep 0.5
xdotool windowfocus "$target"
xdotool mousemove 190 68 sleep 0.1 click 1 sleep 0.1
xdotool type --delay 15 --clearmodifiers -- "$code"
xdotool mousemove 110 138 sleep 0.1 click 1
wait_state "$workdir/state.json" '.code != null'
