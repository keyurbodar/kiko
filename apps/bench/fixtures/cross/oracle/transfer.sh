set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
value=$(cat "$workdir/oracle-value.txt")
xdotool windowfocus "$(window_named "$pid" "Transfer Console")"
xdotool mousemove 200 118 sleep 0.1 click 1
xdotool type --delay 20 --clearmodifiers -- "$value"
xdotool mousemove 110 178 sleep 0.1 click 1
wait_state "$workdir/app-state.json" ".value == $(jq -n --arg v "$value" '$v')"
