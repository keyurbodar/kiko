set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
win=$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")
xdotool windowfocus "$win"
format=$(jq -r .format "$workdir/request.json")
if [ "$format" = "csv" ]; then key=c; else key=j; fi
xdotool key alt+f sleep 0.5 key "$key"
wait_state "$workdir/state.json" ".export == $(jq -n --arg v "$format" '$v')"
